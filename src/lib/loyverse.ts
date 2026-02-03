const LOYVERSE_API_BASE = "https://api.loyverse.com/v1.0";

export type Restaurant =
  | "harveys_wings"
  | "bakugo_ramen"
  | "wildflower"
  | "fika"
  | "harveys_chicken";

export const RESTAURANTS: Restaurant[] = [
  "harveys_wings",
  "bakugo_ramen",
  "wildflower",
  "fika",
  "harveys_chicken",
];

export const RESTAURANT_DISPLAY_NAMES: Record<Restaurant, string> = {
  harveys_wings: "Harvey's Wings",
  bakugo_ramen: "Bakugo Ramen",
  wildflower: "Wildflower Tea House",
  fika: "Fika Cafe",
  harveys_chicken: "Harvey's Chicken",
};

const TOKEN_ENV_VARS: Record<Restaurant, string> = {
  harveys_wings: "LOYVERSE_TOKEN_HARVEYS_WINGS",
  bakugo_ramen: "LOYVERSE_TOKEN_BAKUGO_RAMEN",
  wildflower: "LOYVERSE_TOKEN_WILDFLOWER",
  fika: "LOYVERSE_TOKEN_FIKA",
  harveys_chicken: "LOYVERSE_TOKEN_HARVEYS_CHICKEN",
};

export function getToken(restaurant: Restaurant): string {
  const envVar = TOKEN_ENV_VARS[restaurant];
  const token = process.env[envVar];
  if (!token) {
    throw new Error(`Missing environment variable: ${envVar}`);
  }
  return token;
}

export function isTokenConfigured(restaurant: Restaurant): boolean {
  const envVar = TOKEN_ENV_VARS[restaurant];
  return !!process.env[envVar];
}

interface LoyverseResponse<T> {
  data: T[];
  cursor?: string;
}

export async function loyverseGet<T>(
  restaurant: Restaurant,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T> {
  const token = getToken(restaurant);
  const url = new URL(`${LOYVERSE_API_BASE}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Loyverse API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function loyverseGetAll<T>(
  restaurant: Restaurant,
  endpoint: string,
  dataKey: string,
  params: Record<string, string> = {},
  maxItems: number = 1000
): Promise<T[]> {
  const token = getToken(restaurant);
  const allData: T[] = [];
  let cursor: string | undefined;

  while (allData.length < maxItems) {
    const url = new URL(`${LOYVERSE_API_BASE}${endpoint}`);
    url.searchParams.set("limit", "250");

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Loyverse API error (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    const data = json[dataKey] as T[];

    if (!data || data.length === 0) {
      break;
    }

    allData.push(...data);
    cursor = json.cursor;

    if (!cursor) {
      break;
    }
  }

  return allData.slice(0, maxItems);
}

export function formatCurrency(amount: number): string {
  return `PHP ${amount.toFixed(2)}`;
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
