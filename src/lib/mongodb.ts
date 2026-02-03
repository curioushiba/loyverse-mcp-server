import { MongoClient, Db, Collection } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.warn("Warning: MONGODB_URI environment variable not set");
}

// Document schema for RAG chunks
export interface DocumentChunk {
  _id?: string;
  text: string;
  embedding: number[];
  metadata: {
    restaurant: string;
    csv_type: "products" | "sales" | "inventory";
    filename: string;
    row_index: number;
    uploaded_at: string;
  };
}

// Global connection cache for serverless environment
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  // Return cached connection if available
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  // Create new connection
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db("loyverse");

  // Cache the connection
  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}

export async function getDocumentsCollection(): Promise<Collection<DocumentChunk>> {
  const db = await getDb();
  return db.collection<DocumentChunk>("documents");
}
