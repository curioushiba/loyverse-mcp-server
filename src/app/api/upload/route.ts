import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { generateEmbeddings } from "@/lib/embeddings";
import { insertChunks, deleteByFilename } from "@/lib/rag";
import { DocumentChunk } from "@/lib/mongodb";
import { RESTAURANTS, Restaurant } from "@/lib/loyverse";

type CsvType = "products" | "sales" | "inventory";

const VALID_CSV_TYPES: CsvType[] = ["products", "sales", "inventory"];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

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
      if (row.receipt_number) parts.push(`Receipt: ${row.receipt_number}`);
      if (row.date || row.created_at) parts.push(`Date: ${row.date || row.created_at}`);
      const total = formatCurrency(row.total || row.total_money);
      if (total) parts.push(`Total: ${total}`);
      if (row.payment_type) parts.push(`Payment: ${row.payment_type}`);
      if (row.item_name) parts.push(`Item: ${row.item_name}`);
      if (row.quantity) parts.push(`Qty: ${row.quantity}`);
      if (row.employee) parts.push(`Employee: ${row.employee}`);
      if (row.store) parts.push(`Store: ${row.store}`);
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
    const csvType = formData.get("csvType") as string | null;

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

    if (!csvType || !VALID_CSV_TYPES.includes(csvType as CsvType)) {
      return NextResponse.json(
        { error: `Invalid CSV type. Must be one of: ${VALID_CSV_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Read file content
    const fileContent = await file.text();
    const filename = file.name;

    // Delete existing entries for this file (allows re-uploading)
    await deleteByFilename(filename);

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

    // Convert rows to text chunks
    const uploadedAt = new Date().toISOString();
    const texts = rows.map((row, index) => ({
      text: rowToText(row, csvType as CsvType, restaurant),
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
