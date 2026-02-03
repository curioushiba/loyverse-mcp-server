import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { generateEmbeddings } from "@/lib/embeddings";
import { insertChunks, deleteByFilename } from "@/lib/rag";
import { DocumentChunk } from "@/lib/mongodb";
import { RESTAURANTS, Restaurant } from "@/lib/loyverse";

/**
 * CSV type categories:
 * - products: Product catalog exports (items, prices, costs)
 * - sales: Both receipt-level transactions AND item sales summaries
 * - inventory: Stock level reports
 */
type CsvType = "products" | "sales" | "inventory";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Auto-detect CSV type based on column headers
 */
function detectCsvType(headers: string[]): CsvType | null {
  const h = new Set(headers.map((col) => col.toLowerCase().trim().replace(/\s+/g, "_")));

  // Sales: receipt-level OR summary reports
  // Receipt-level: receipt_number, payment_type, total_money
  // Summary reports: gross_sales, net_sales, items_sold
  if (
    h.has("receipt_number") || h.has("payment_type") || h.has("total_money") ||
    h.has("gross_sales") || h.has("net_sales") || h.has("items_sold")
  ) {
    return "sales";
  }

  // Inventory: in_stock, low_stock_level, or stock without price
  if (h.has("in_stock") || h.has("low_stock_level") || (h.has("stock") && !h.has("price"))) {
    return "inventory";
  }

  // Products: price + cost, or price + category
  if (h.has("price") && (h.has("cost") || h.has("category"))) {
    return "products";
  }

  return null; // Unknown
}

function formatCurrency(value: string): string | null {
  const num = parseFloat(value);
  return isNaN(num) ? null : `PHP ${num.toFixed(2)}`;
}

/**
 * Convert a CSV row to a searchable text chunk based on CSV type
 */
function rowToText(
  row: Record<string, string>,
  csvType: CsvType,
  restaurant: string
): string {
  const restaurantDisplay = restaurant.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const parts: string[] = [`[${restaurantDisplay}]`];

  switch (csvType) {
    case "products": {
      if (row.item_name || row.name) parts.push(`Product: ${row.item_name || row.name}`);
      if (row.category) parts.push(`Category: ${row.category}`);
      const price = formatCurrency(row.price);
      if (price) parts.push(`Price: ${price}`);
      const cost = formatCurrency(row.cost);
      if (cost) parts.push(`Cost: ${cost}`);
      if (row.sku) parts.push(`SKU: ${row.sku}`);
      if (row.variant_name) parts.push(`Variant: ${row.variant_name}`);
      if (row.description) parts.push(`Description: ${row.description}`);
      break;
    }

    case "sales": {
      // Common fields (used by both receipt-level and summary reports)
      if (row.receipt_number) parts.push(`Receipt: ${row.receipt_number}`);
      if (row.date || row.created_at) parts.push(`Date: ${row.date || row.created_at}`);
      const total = formatCurrency(row.total || row.total_money);
      if (total) parts.push(`Total: ${total}`);
      if (row.payment_type) parts.push(`Payment: ${row.payment_type}`);
      if (row.item_name || row.name) parts.push(`Item: ${row.item_name || row.name}`);
      if (row.quantity) parts.push(`Qty: ${row.quantity}`);
      if (row.employee) parts.push(`Employee: ${row.employee}`);
      if (row.store) parts.push(`Store: ${row.store}`);
      // Summary report fields
      if (row.sku) parts.push(`SKU: ${row.sku}`);
      if (row.category) parts.push(`Category: ${row.category}`);
      if (row.items_sold) parts.push(`Items Sold: ${row.items_sold}`);
      const grossSales = formatCurrency(row.gross_sales);
      if (grossSales) parts.push(`Gross Sales: ${grossSales}`);
      const netSales = formatCurrency(row.net_sales);
      if (netSales) parts.push(`Net Sales: ${netSales}`);
      const grossProfit = formatCurrency(row.gross_profit);
      if (grossProfit) parts.push(`Gross Profit: ${grossProfit}`);
      const refunds = formatCurrency(row.refunds);
      if (refunds) parts.push(`Refunds: ${refunds}`);
      const discounts = formatCurrency(row.discounts);
      if (discounts) parts.push(`Discounts: ${discounts}`);
      break;
    }

    case "inventory":
      if (row.item_name || row.name) parts.push(`Item: ${row.item_name || row.name}`);
      if (row.sku) parts.push(`SKU: ${row.sku}`);
      if (row.stock || row.quantity || row.in_stock) parts.push(`Stock: ${row.stock || row.quantity || row.in_stock}`);
      if (row.store) parts.push(`Store: ${row.store}`);
      if (row.low_stock_level) parts.push(`Low Stock Alert: ${row.low_stock_level}`);
      if (row.variant_name) parts.push(`Variant: ${row.variant_name}`);
      break;
  }

  // If we couldn't extract structured data, just join all values
  if (parts.length <= 1) {
    const values = Object.entries(row)
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `${k}: ${v}`);
    parts.push(...values);
  }

  return parts.join(" | ");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const restaurant = formData.get("restaurant") as string | null;

    // Validate inputs
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB` },
        { status: 400 }
      );
    }

    if (!restaurant || !RESTAURANTS.includes(restaurant as Restaurant)) {
      return NextResponse.json(
        { error: `Invalid restaurant. Must be one of: ${RESTAURANTS.join(", ")}` },
        { status: 400 }
      );
    }

    // Read file content
    const fileContent = await file.text();
    const filename = file.name;

    // Parse CSV
    const parseResult = Papa.parse<Record<string, string>>(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.toLowerCase().trim().replace(/\s+/g, "_"),
    });

    if (parseResult.errors.length > 0) {
      console.warn("CSV parsing warnings:", parseResult.errors);
    }

    const rows = parseResult.data;

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV file is empty or has no data rows" }, { status: 400 });
    }

    // Auto-detect CSV type from headers
    const headers = parseResult.meta.fields || [];
    const csvType = detectCsvType(headers);

    if (!csvType) {
      return NextResponse.json(
        {
          error:
            "Could not detect CSV type. Expected columns for products (price + cost or category), sales (receipt_number, payment_type, total_money, gross_sales, net_sales, or items_sold), or inventory (in_stock, low_stock_level, or stock).",
        },
        { status: 400 }
      );
    }

    // Delete existing entries for this file (allows re-uploading)
    await deleteByFilename(filename);

    // Convert rows to text chunks
    const uploadedAt = new Date().toISOString();
    const texts = rows.map((row, index) => ({
      text: rowToText(row, csvType, restaurant),
      rowIndex: index,
    }));

    // Generate embeddings in batches
    const embeddings = await generateEmbeddings(texts.map((t) => t.text));

    // Create document chunks
    const chunks: Omit<DocumentChunk, "_id">[] = texts.map((t, i) => ({
      text: t.text,
      embedding: embeddings[i],
      metadata: {
        restaurant,
        csv_type: csvType as CsvType,
        filename,
        row_index: t.rowIndex,
        uploaded_at: uploadedAt,
      },
    }));

    // Insert into MongoDB
    const insertedCount = await insertChunks(chunks);

    return NextResponse.json({
      success: true,
      message: `Successfully uploaded ${insertedCount} rows from ${filename}`,
      details: {
        filename,
        restaurant,
        csv_type: csvType,
        csv_type_detected: true,
        rows_processed: insertedCount,
        uploaded_at: uploadedAt,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
