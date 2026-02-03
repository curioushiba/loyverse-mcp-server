import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  Restaurant,
  RESTAURANTS,
  RESTAURANT_DISPLAY_NAMES,
  isTokenConfigured,
  loyverseGet,
  loyverseGetAll,
  formatCurrency,
  formatDate,
} from "@/lib/loyverse";

const restaurantSchema = z.enum([
  "harveys_wings",
  "bakugo_ramen",
  "wildflower",
  "fika",
  "harveys_chicken",
]);

interface Store {
  id: string;
  name: string;
  address?: string;
  phone_number?: string;
}

interface Merchant {
  id: string;
  name: string;
  email?: string;
  phone_number?: string;
  owner_name?: string;
  business_id?: string;
}

interface Item {
  id: string;
  item_name: string;
  category_id?: string;
  price?: number;
  cost?: number;
  sku?: string;
  in_stock?: boolean;
}

interface Category {
  id: string;
  name: string;
  color?: string;
}

interface Receipt {
  receipt_number: string;
  receipt_date: string;
  total_money: number;
  total_tax?: number;
  store_id?: string;
  employee_id?: string;
  line_items?: Array<{
    item_name: string;
    quantity: number;
    price: number;
    total_money: number;
  }>;
  payments?: Array<{
    payment_type_id: string;
    money_amount: number;
  }>;
}

interface InventoryLevel {
  variant_id: string;
  store_id: string;
  in_stock: number;
}

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone_number?: string;
  total_spent?: number;
  total_visits?: number;
}

interface Employee {
  id: string;
  name: string;
  email?: string;
  phone_number?: string;
  stores?: string[];
}

interface PaymentType {
  id: string;
  name: string;
  type: string;
}

const handler = createMcpHandler(
  (server) => {
    // Tool 1: List all restaurants and their connection status
    server.registerTool(
      "loyverse_list_restaurants",
      {
        title: "List Restaurants",
        description:
          "List all 5 configured Loyverse restaurant accounts and their connection status.",
        inputSchema: {},
      },
      async () => {
        const results = RESTAURANTS.map((r) => ({
          id: r,
          name: RESTAURANT_DISPLAY_NAMES[r],
          connected: isTokenConfigured(r),
        }));

        const connected = results.filter((r) => r.connected).length;
        let text = `## Loyverse Restaurants (${connected}/${RESTAURANTS.length} connected)\n\n`;

        for (const r of results) {
          const status = r.connected ? "Connected" : "Not configured";
          text += `- **${r.name}** (${r.id}): ${status}\n`;
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 2: Get stores for a restaurant
    server.registerTool(
      "loyverse_get_stores",
      {
        title: "Get Stores",
        description:
          "Get all store locations for a specific restaurant account.",
        inputSchema: {
          restaurant: restaurantSchema.describe(
            "Restaurant identifier (e.g., harveys_wings, bakugo_ramen)"
          ),
        },
      },
      async ({ restaurant }) => {
        const data = await loyverseGetAll<Store>(
          restaurant as Restaurant,
          "/stores",
          "stores"
        );

        let text = `## Stores for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;

        if (data.length === 0) {
          text += "No stores found.";
        } else {
          for (const store of data) {
            text += `### ${store.name}\n`;
            text += `- ID: ${store.id}\n`;
            if (store.address) text += `- Address: ${store.address}\n`;
            if (store.phone_number) text += `- Phone: ${store.phone_number}\n`;
            text += "\n";
          }
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 3: Get merchant info
    server.registerTool(
      "loyverse_get_merchant",
      {
        title: "Get Merchant",
        description: "Get business/account information for a restaurant.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
        },
      },
      async ({ restaurant }) => {
        const merchant = await loyverseGet<Merchant>(
          restaurant as Restaurant,
          "/merchant"
        );

        let text = `## Merchant: ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `- **Business Name:** ${merchant.name || "N/A"}\n`;
        text += `- **ID:** ${merchant.id}\n`;
        if (merchant.email) text += `- **Email:** ${merchant.email}\n`;
        if (merchant.phone_number)
          text += `- **Phone:** ${merchant.phone_number}\n`;
        if (merchant.owner_name)
          text += `- **Owner:** ${merchant.owner_name}\n`;
        if (merchant.business_id)
          text += `- **Business ID:** ${merchant.business_id}\n`;

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 4: List items/menu
    server.registerTool(
      "loyverse_list_items",
      {
        title: "List Items",
        description:
          "Get menu items/products for a restaurant. Optionally filter by category.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
          category_id: z
            .string()
            .optional()
            .describe("Filter by category ID (optional)"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .optional()
            .describe("Max items to return (default 100)"),
        },
      },
      async ({ restaurant, category_id, limit }) => {
        const params: Record<string, string> = {};
        if (category_id) params.category_id = category_id;

        const items = await loyverseGetAll<Item>(
          restaurant as Restaurant,
          "/items",
          "items",
          params,
          limit || 100
        );

        let text = `## Menu Items for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `Found ${items.length} items.\n\n`;

        for (const item of items) {
          text += `### ${item.item_name}\n`;
          if (item.price !== undefined)
            text += `- Price: ${formatCurrency(item.price)}\n`;
          if (item.sku) text += `- SKU: ${item.sku}\n`;
          if (item.cost !== undefined)
            text += `- Cost: ${formatCurrency(item.cost)}\n`;
          text += "\n";
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 5: List categories
    server.registerTool(
      "loyverse_list_categories",
      {
        title: "List Categories",
        description: "Get all item categories for a restaurant.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
        },
      },
      async ({ restaurant }) => {
        const categories = await loyverseGetAll<Category>(
          restaurant as Restaurant,
          "/categories",
          "categories"
        );

        let text = `## Categories for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;

        if (categories.length === 0) {
          text += "No categories found.";
        } else {
          for (const cat of categories) {
            text += `- **${cat.name}** (ID: ${cat.id})\n`;
          }
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 6: List receipts/transactions
    server.registerTool(
      "loyverse_list_receipts",
      {
        title: "List Receipts",
        description:
          "Get sales receipts/transactions for a restaurant within a date range.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
          created_at_min: z
            .string()
            .optional()
            .describe("Start date in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)"),
          created_at_max: z
            .string()
            .optional()
            .describe("End date in ISO 8601 format"),
          store_id: z.string().optional().describe("Filter by store ID"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .optional()
            .describe("Max receipts to return (default 50)"),
        },
      },
      async ({ restaurant, created_at_min, created_at_max, store_id, limit }) => {
        const params: Record<string, string> = {};
        if (created_at_min) params.created_at_min = created_at_min;
        if (created_at_max) params.created_at_max = created_at_max;
        if (store_id) params.store_id = store_id;

        const receipts = await loyverseGetAll<Receipt>(
          restaurant as Restaurant,
          "/receipts",
          "receipts",
          params,
          limit || 50
        );

        let text = `## Receipts for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `Found ${receipts.length} receipts.\n\n`;

        let totalSales = 0;
        for (const receipt of receipts) {
          totalSales += receipt.total_money;
          text += `### Receipt #${receipt.receipt_number}\n`;
          text += `- Date: ${formatDate(receipt.receipt_date)}\n`;
          text += `- Total: ${formatCurrency(receipt.total_money)}\n`;
          if (receipt.total_tax)
            text += `- Tax: ${formatCurrency(receipt.total_tax)}\n`;
          text += "\n";
        }

        text += `---\n**Total Sales:** ${formatCurrency(totalSales)}\n`;

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 7: Get inventory levels
    server.registerTool(
      "loyverse_get_inventory",
      {
        title: "Get Inventory",
        description: "Get current stock levels for a restaurant.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
          store_id: z.string().optional().describe("Filter by store ID"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .optional()
            .describe("Max items to return (default 100)"),
        },
      },
      async ({ restaurant, store_id, limit }) => {
        const params: Record<string, string> = {};
        if (store_id) params.store_id = store_id;

        const inventory = await loyverseGetAll<InventoryLevel>(
          restaurant as Restaurant,
          "/inventory",
          "inventory_levels",
          params,
          limit || 100
        );

        let text = `## Inventory for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `Found ${inventory.length} inventory records.\n\n`;

        // Group by store
        const byStore: Record<string, InventoryLevel[]> = {};
        for (const inv of inventory) {
          const sid = inv.store_id || "unknown";
          if (!byStore[sid]) byStore[sid] = [];
          byStore[sid].push(inv);
        }

        for (const [storeId, levels] of Object.entries(byStore)) {
          text += `### Store: ${storeId}\n`;
          for (const level of levels) {
            text += `- Variant ${level.variant_id}: ${level.in_stock} in stock\n`;
          }
          text += "\n";
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 8: List customers
    server.registerTool(
      "loyverse_list_customers",
      {
        title: "List Customers",
        description: "Get customer list for a restaurant.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
          email: z.string().optional().describe("Filter by email address"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .optional()
            .describe("Max customers to return (default 50)"),
        },
      },
      async ({ restaurant, email, limit }) => {
        const params: Record<string, string> = {};
        if (email) params.email = email;

        const customers = await loyverseGetAll<Customer>(
          restaurant as Restaurant,
          "/customers",
          "customers",
          params,
          limit || 50
        );

        let text = `## Customers for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `Found ${customers.length} customers.\n\n`;

        for (const customer of customers) {
          text += `### ${customer.name || "Unknown"}\n`;
          text += `- ID: ${customer.id}\n`;
          if (customer.email) text += `- Email: ${customer.email}\n`;
          if (customer.phone_number)
            text += `- Phone: ${customer.phone_number}\n`;
          if (customer.total_spent !== undefined)
            text += `- Total Spent: ${formatCurrency(customer.total_spent)}\n`;
          if (customer.total_visits !== undefined)
            text += `- Visits: ${customer.total_visits}\n`;
          text += "\n";
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 9: List employees
    server.registerTool(
      "loyverse_list_employees",
      {
        title: "List Employees",
        description: "Get staff list for a restaurant.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
        },
      },
      async ({ restaurant }) => {
        const employees = await loyverseGetAll<Employee>(
          restaurant as Restaurant,
          "/employees",
          "employees"
        );

        let text = `## Employees for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;

        if (employees.length === 0) {
          text += "No employees found.";
        } else {
          for (const emp of employees) {
            text += `### ${emp.name}\n`;
            text += `- ID: ${emp.id}\n`;
            if (emp.email) text += `- Email: ${emp.email}\n`;
            if (emp.phone_number) text += `- Phone: ${emp.phone_number}\n`;
            text += "\n";
          }
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 10: List payment types
    server.registerTool(
      "loyverse_list_payment_types",
      {
        title: "List Payment Types",
        description:
          "Get available payment methods for a restaurant (Cash, Card, GCash, etc.).",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
        },
      },
      async ({ restaurant }) => {
        const paymentTypes = await loyverseGetAll<PaymentType>(
          restaurant as Restaurant,
          "/payment_types",
          "payment_types"
        );

        let text = `## Payment Types for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;

        if (paymentTypes.length === 0) {
          text += "No payment types found.";
        } else {
          for (const pt of paymentTypes) {
            text += `- **${pt.name}** (${pt.type}) - ID: ${pt.id}\n`;
          }
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 11: Sales summary
    server.registerTool(
      "loyverse_sales_summary",
      {
        title: "Sales Summary",
        description:
          "Get aggregated sales summary for a restaurant for the last N days.",
        inputSchema: {
          restaurant: restaurantSchema.describe("Restaurant identifier"),
          days: z
            .number()
            .int()
            .min(1)
            .max(90)
            .optional()
            .describe("Number of days to summarize (default 7)"),
        },
      },
      async ({ restaurant, days }) => {
        const numDays = days || 7;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - numDays);

        const params: Record<string, string> = {
          created_at_min: startDate.toISOString(),
          created_at_max: endDate.toISOString(),
        };

        const receipts = await loyverseGetAll<Receipt>(
          restaurant as Restaurant,
          "/receipts",
          "receipts",
          params,
          1000
        );

        const totalSales = receipts.reduce((sum, r) => sum + r.total_money, 0);
        const totalTax = receipts.reduce(
          (sum, r) => sum + (r.total_tax || 0),
          0
        );
        const avgTransaction =
          receipts.length > 0 ? totalSales / receipts.length : 0;

        // Group by day
        const byDay: Record<string, { count: number; total: number }> = {};
        for (const receipt of receipts) {
          const day = receipt.receipt_date.split("T")[0];
          if (!byDay[day]) byDay[day] = { count: 0, total: 0 };
          byDay[day].count++;
          byDay[day].total += receipt.total_money;
        }

        let text = `## Sales Summary for ${RESTAURANT_DISPLAY_NAMES[restaurant as Restaurant]}\n\n`;
        text += `**Period:** Last ${numDays} days (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})\n\n`;
        text += `### Overview\n`;
        text += `- **Total Sales:** ${formatCurrency(totalSales)}\n`;
        text += `- **Total Transactions:** ${receipts.length}\n`;
        text += `- **Total Tax:** ${formatCurrency(totalTax)}\n`;
        text += `- **Avg Transaction:** ${formatCurrency(avgTransaction)}\n\n`;

        text += `### Daily Breakdown\n`;
        const sortedDays = Object.entries(byDay).sort((a, b) =>
          b[0].localeCompare(a[0])
        );
        for (const [day, data] of sortedDays) {
          text += `- **${day}:** ${formatCurrency(data.total)} (${data.count} transactions)\n`;
        }

        return { content: [{ type: "text", text }] };
      }
    );

    // Tool 12: Compare restaurants
    server.registerTool(
      "loyverse_compare_restaurants",
      {
        title: "Compare Restaurants",
        description:
          "Compare sales across multiple or all restaurants for the last N days.",
        inputSchema: {
          restaurants: z
            .array(restaurantSchema)
            .optional()
            .describe(
              "List of restaurant IDs to compare. If empty, compares all connected restaurants."
            ),
          days: z
            .number()
            .int()
            .min(1)
            .max(90)
            .optional()
            .describe("Number of days to compare (default 7)"),
        },
      },
      async ({ restaurants, days }) => {
        const numDays = days || 7;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - numDays);

        const params: Record<string, string> = {
          created_at_min: startDate.toISOString(),
          created_at_max: endDate.toISOString(),
        };

        // Use provided restaurants or all connected ones
        const restaurantList =
          restaurants && restaurants.length > 0
            ? (restaurants as Restaurant[])
            : RESTAURANTS.filter(isTokenConfigured);

        const results: Array<{
          restaurant: Restaurant;
          name: string;
          totalSales: number;
          transactions: number;
          avgTransaction: number;
        }> = [];

        for (const restaurant of restaurantList) {
          try {
            const receipts = await loyverseGetAll<Receipt>(
              restaurant,
              "/receipts",
              "receipts",
              params,
              1000
            );

            const totalSales = receipts.reduce(
              (sum, r) => sum + r.total_money,
              0
            );
            const avgTransaction =
              receipts.length > 0 ? totalSales / receipts.length : 0;

            results.push({
              restaurant,
              name: RESTAURANT_DISPLAY_NAMES[restaurant],
              totalSales,
              transactions: receipts.length,
              avgTransaction,
            });
          } catch (error) {
            results.push({
              restaurant,
              name: RESTAURANT_DISPLAY_NAMES[restaurant],
              totalSales: 0,
              transactions: 0,
              avgTransaction: 0,
            });
          }
        }

        // Sort by total sales descending
        results.sort((a, b) => b.totalSales - a.totalSales);

        const grandTotal = results.reduce((sum, r) => sum + r.totalSales, 0);
        const totalTransactions = results.reduce(
          (sum, r) => sum + r.transactions,
          0
        );

        let text = `## Restaurant Comparison\n\n`;
        text += `**Period:** Last ${numDays} days (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})\n\n`;

        text += `### Rankings by Sales\n\n`;
        text += `| Rank | Restaurant | Sales | Transactions | Avg Trans | % of Total |\n`;
        text += `|------|------------|-------|--------------|-----------|------------|\n`;

        results.forEach((r, i) => {
          const pct =
            grandTotal > 0 ? ((r.totalSales / grandTotal) * 100).toFixed(1) : 0;
          text += `| ${i + 1} | ${r.name} | ${formatCurrency(r.totalSales)} | ${r.transactions} | ${formatCurrency(r.avgTransaction)} | ${pct}% |\n`;
        });

        text += `\n### Totals\n`;
        text += `- **Grand Total Sales:** ${formatCurrency(grandTotal)}\n`;
        text += `- **Total Transactions:** ${totalTransactions}\n`;
        text += `- **Avg per Restaurant:** ${formatCurrency(grandTotal / results.length)}\n`;

        return { content: [{ type: "text", text }] };
      }
    );
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

export { handler as GET, handler as POST };
