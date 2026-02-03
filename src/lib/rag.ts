/**
 * RAG (Retrieval-Augmented Generation) Library
 *
 * Implements hybrid search using MongoDB Atlas with:
 * - Vector Search (semantic similarity)
 * - Full-Text Search (keyword matching)
 * - Reciprocal Rank Fusion (RRF) for combining results
 *
 * Uses local embeddings via @huggingface/transformers (no API cost)
 */

import { MongoClient, Collection, Document as MongoDocument } from "mongodb";

// ============================================================================
// Types
// ============================================================================

export type DocumentType = "menu" | "recipe" | "sop" | "policy" | "manual" | "other";

export interface DocumentMetadata {
  type: DocumentType;
  title: string;
  restaurant?: string;
  section?: string;
  page?: number;
  tags?: string[];
}

export interface DocumentChunk {
  _id?: string;
  document_id: string;
  restaurant: string;
  content: string;
  embedding: number[];
  metadata: DocumentMetadata;
  chunk_index: number;
  created_at: Date;
}

export interface StoredDocument {
  _id?: string;
  document_id: string;
  restaurant: string;
  title: string;
  type: DocumentType;
  content: string;
  chunk_count: number;
  created_at: Date;
}

export interface SearchResult {
  content: string;
  metadata: DocumentMetadata;
  score: number;
  source: "vector" | "text" | "both";
  document_id: string;
}

export interface IngestResult {
  documentId: string;
  chunksCreated: number;
  title: string;
}

export interface DocumentSummary {
  document_id: string;
  title: string;
  type: DocumentType;
  chunk_count: number;
  created_at: Date;
}

// ============================================================================
// Configuration
// ============================================================================

const MONGODB_URI_KEY = "MONGODB_URI";
const OPENAI_API_KEY = "OPENAI_API_KEY";
const DB_NAME = "loyverse_rag";
const CHUNKS_COLLECTION = "chunks";
const DOCUMENTS_COLLECTION = "documents";

// Embedding configuration (OpenAI text-embedding-3-small)
// Cost: ~$0.02 per 1M tokens - very affordable!
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_DIMENSIONS = 1536;

// Search configuration
const RRF_K = 60; // Reciprocal Rank Fusion constant
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;

// ============================================================================
// MongoDB Connection
// ============================================================================

let client: MongoClient | null = null;
let isConnecting = false;

function getMongoUri(): string {
  const uri = process.env[MONGODB_URI_KEY];
  if (!uri) {
    throw new Error(
      `Missing environment variable: ${MONGODB_URI_KEY}. ` +
      `Please set it to your MongoDB Atlas connection string.`
    );
  }
  return uri;
}

async function getClient(): Promise<MongoClient> {
  if (client) {
    return client;
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (client) return client;
  }

  isConnecting = true;
  try {
    const uri = getMongoUri();
    client = new MongoClient(uri);
    await client.connect();
    return client;
  } finally {
    isConnecting = false;
  }
}

async function getChunksCollection(): Promise<Collection<DocumentChunk>> {
  const mongoClient = await getClient();
  return mongoClient.db(DB_NAME).collection<DocumentChunk>(CHUNKS_COLLECTION);
}

async function getDocumentsCollection(): Promise<Collection<StoredDocument>> {
  const mongoClient = await getClient();
  return mongoClient.db(DB_NAME).collection<StoredDocument>(DOCUMENTS_COLLECTION);
}

export function isRAGConfigured(): boolean {
  return !!process.env[MONGODB_URI_KEY] && !!process.env[OPENAI_API_KEY];
}

// ============================================================================
// Embedding Generation (OpenAI API - fast, cheap, high quality)
// ============================================================================

function getOpenAIKey(): string {
  const key = process.env[OPENAI_API_KEY];
  if (!key) {
    throw new Error(
      `Missing environment variable: ${OPENAI_API_KEY}. ` +
      `Get your API key from https://platform.openai.com/api-keys`
    );
  }
  return key;
}

export function isEmbeddingsConfigured(): boolean {
  return !!process.env[OPENAI_API_KEY];
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = getOpenAIKey();

  const response = await fetch(OPENAI_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embedding error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json.data[0].embedding;
}

async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = getOpenAIKey();

  // OpenAI supports batch embeddings in a single request (up to 2048 inputs)
  const response = await fetch(OPENAI_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embedding error (${response.status}): ${errorText}`);
  }

  const json = await response.json();

  // Sort by index to ensure correct order
  const sorted = json.data.sort((a: any, b: any) => a.index - b.index);
  return sorted.map((item: any) => item.embedding);
}

// ============================================================================
// Document Chunking
// ============================================================================

interface ChunkResult {
  content: string;
  index: number;
}

function chunkText(
  text: string,
  maxChars: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_CHUNK_OVERLAP
): ChunkResult[] {
  const chunks: ChunkResult[] = [];

  // First, try to split by paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  let currentChunk = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmedPara = para.trim();

    if (!trimmedPara) continue;

    // If adding this paragraph exceeds max size, save current chunk
    if (currentChunk && (currentChunk.length + trimmedPara.length + 2) > maxChars) {
      chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });

      // Keep overlap from end of previous chunk
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + "\n\n" + trimmedPara;
      } else {
        currentChunk = trimmedPara;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
    }

    // Handle very long paragraphs
    while (currentChunk.length > maxChars) {
      const splitPoint = currentChunk.lastIndexOf(" ", maxChars);
      const actualSplit = splitPoint > maxChars / 2 ? splitPoint : maxChars;

      chunks.push({
        content: currentChunk.slice(0, actualSplit).trim(),
        index: chunkIndex++
      });

      currentChunk = currentChunk.slice(actualSplit - overlap).trim();
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex });
  }

  return chunks;
}

// ============================================================================
// Reciprocal Rank Fusion (RRF)
// ============================================================================

interface RankedResult {
  id: string;
  rank: number;
  doc: DocumentChunk;
}

function reciprocalRankFusion(
  vectorResults: RankedResult[],
  textResults: RankedResult[],
  k: number = RRF_K
): SearchResult[] {
  const scores = new Map<string, {
    score: number;
    doc: DocumentChunk;
    sources: Set<"vector" | "text">;
  }>();

  // Score vector search results
  for (const { id, rank, doc } of vectorResults) {
    const rrfScore = 1 / (k + rank);
    const existing = scores.get(id);

    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("vector");
    } else {
      scores.set(id, {
        score: rrfScore,
        doc,
        sources: new Set(["vector"])
      });
    }
  }

  // Score text search results
  for (const { id, rank, doc } of textResults) {
    const rrfScore = 1 / (k + rank);
    const existing = scores.get(id);

    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("text");
    } else {
      scores.set(id, {
        score: rrfScore,
        doc,
        sources: new Set(["text"])
      });
    }
  }

  // Sort by combined RRF score and convert to SearchResult
  return Array.from(scores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([_, { score, doc, sources }]) => ({
      content: doc.content,
      metadata: doc.metadata,
      score,
      source: sources.size === 2 ? "both" : (sources.has("vector") ? "vector" : "text"),
      document_id: doc.document_id,
    }));
}

// ============================================================================
// Hybrid Search
// ============================================================================

export async function hybridSearch(
  restaurant: string,
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  const collection = await getChunksCollection();
  const queryEmbedding = await generateEmbedding(query);

  // Run both searches concurrently
  const [vectorResults, textResults] = await Promise.all([
    // Vector search (semantic)
    collection.aggregate<DocumentChunk>([
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: limit * 20,
          limit: limit * 3,
          filter: { restaurant: restaurant }
        }
      },
      {
        $project: {
          _id: 1,
          document_id: 1,
          content: 1,
          metadata: 1,
          chunk_index: 1,
          restaurant: 1,
          embedding: 1,
          created_at: 1,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ]).toArray(),

    // Text search (keyword)
    collection.aggregate<DocumentChunk>([
      {
        $search: {
          index: "text_index",
          text: {
            query: query,
            path: "content",
            fuzzy: { maxEdits: 1 }
          }
        }
      },
      {
        $match: { restaurant: restaurant }
      },
      {
        $limit: limit * 3
      },
      {
        $project: {
          _id: 1,
          document_id: 1,
          content: 1,
          metadata: 1,
          chunk_index: 1,
          restaurant: 1,
          embedding: 1,
          created_at: 1,
          score: { $meta: "searchScore" }
        }
      }
    ]).toArray()
  ]);

  // Convert to ranked format for RRF
  const vectorRanked: RankedResult[] = vectorResults.map((doc, i) => ({
    id: doc._id?.toString() || `v_${i}`,
    rank: i + 1,
    doc: doc as DocumentChunk
  }));

  const textRanked: RankedResult[] = textResults.map((doc, i) => ({
    id: doc._id?.toString() || `t_${i}`,
    rank: i + 1,
    doc: doc as DocumentChunk
  }));

  // Apply Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(vectorRanked, textRanked);

  return fusedResults.slice(0, limit);
}

// ============================================================================
// Document Ingestion
// ============================================================================

export async function ingestDocument(
  restaurant: string,
  content: string,
  metadata: { title: string; type: DocumentType; tags?: string[] },
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<IngestResult> {
  const chunksCollection = await getChunksCollection();
  const docsCollection = await getDocumentsCollection();

  const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Chunk the document
  const chunks = chunkText(content, chunkSize);

  // Generate embeddings for all chunks
  const chunkTexts = chunks.map(c => c.content);
  const embeddings = await generateBatchEmbeddings(chunkTexts);

  // Prepare chunk documents
  const chunkDocs: DocumentChunk[] = chunks.map((chunk, i) => ({
    document_id: documentId,
    restaurant,
    content: chunk.content,
    embedding: embeddings[i],
    metadata: {
      ...metadata,
      section: `chunk_${chunk.index + 1}`
    },
    chunk_index: chunk.index,
    created_at: new Date()
  }));

  // Store chunks
  if (chunkDocs.length > 0) {
    await chunksCollection.insertMany(chunkDocs);
  }

  // Store document metadata
  const storedDoc: StoredDocument = {
    document_id: documentId,
    restaurant,
    title: metadata.title,
    type: metadata.type,
    content: content,
    chunk_count: chunkDocs.length,
    created_at: new Date()
  };

  await docsCollection.insertOne(storedDoc);

  return {
    documentId,
    chunksCreated: chunkDocs.length,
    title: metadata.title
  };
}

// ============================================================================
// Document Management
// ============================================================================

export async function listDocuments(restaurant: string): Promise<DocumentSummary[]> {
  const collection = await getDocumentsCollection();

  const docs = await collection
    .find({ restaurant })
    .sort({ created_at: -1 })
    .toArray();

  return docs.map(doc => ({
    document_id: doc.document_id,
    title: doc.title,
    type: doc.type,
    chunk_count: doc.chunk_count,
    created_at: doc.created_at
  }));
}

export async function deleteDocument(
  restaurant: string,
  documentId: string
): Promise<{ chunksDeleted: number; documentDeleted: boolean }> {
  const chunksCollection = await getChunksCollection();
  const docsCollection = await getDocumentsCollection();

  // Delete chunks
  const chunksResult = await chunksCollection.deleteMany({
    restaurant,
    document_id: documentId
  });

  // Delete document metadata
  const docResult = await docsCollection.deleteOne({
    restaurant,
    document_id: documentId
  });

  return {
    chunksDeleted: chunksResult.deletedCount,
    documentDeleted: docResult.deletedCount > 0
  };
}

export async function getDocument(
  restaurant: string,
  documentId: string
): Promise<StoredDocument | null> {
  const collection = await getDocumentsCollection();
  return collection.findOne({ restaurant, document_id: documentId });
}

// ============================================================================
// Statistics
// ============================================================================

export async function getRAGStats(restaurant?: string): Promise<{
  totalDocuments: number;
  totalChunks: number;
  documentsByType: Record<DocumentType, number>;
}> {
  const chunksCollection = await getChunksCollection();
  const docsCollection = await getDocumentsCollection();

  const filter = restaurant ? { restaurant } : {};

  const [totalDocuments, totalChunks, typeAgg] = await Promise.all([
    docsCollection.countDocuments(filter),
    chunksCollection.countDocuments(filter),
    docsCollection.aggregate<{ _id: DocumentType; count: number }>([
      { $match: filter },
      { $group: { _id: "$type", count: { $sum: 1 } } }
    ]).toArray()
  ]);

  const documentsByType: Record<DocumentType, number> = {
    menu: 0,
    recipe: 0,
    sop: 0,
    policy: 0,
    manual: 0,
    other: 0
  };

  for (const agg of typeAgg) {
    if (agg._id in documentsByType) {
      documentsByType[agg._id] = agg.count;
    }
  }

  return { totalDocuments, totalChunks, documentsByType };
}
