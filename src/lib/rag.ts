import { getDocumentsCollection, DocumentChunk } from "./mongodb";
import { generateEmbedding } from "./embeddings";

export interface SearchResult {
  text: string;
  score: number;
  metadata: DocumentChunk["metadata"];
}

export interface SearchFilters {
  restaurant?: string;
  csv_type?: "products" | "sales" | "inventory";
}

export interface DocumentInfo {
  filename: string;
  restaurant: string;
  csv_type: string;
  row_count: number;
  uploaded_at: string;
}

/**
 * Hybrid search combining vector search and text search with RRF fusion
 */
export async function hybridSearch(
  query: string,
  filters: SearchFilters = {},
  limit: number = 10
): Promise<SearchResult[]> {
  const collection = await getDocumentsCollection();

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(query);

  // Build filter for metadata
  const metadataFilter: Record<string, unknown> = {};
  if (filters.restaurant) {
    metadataFilter["metadata.restaurant"] = filters.restaurant;
  }
  if (filters.csv_type) {
    metadataFilter["metadata.csv_type"] = filters.csv_type;
  }

  // Run vector search and text search in parallel
  const [vectorResults, textResults] = await Promise.all([
    vectorSearch(collection, queryEmbedding, metadataFilter, 20),
    textSearch(collection, query, metadataFilter, 20),
  ]);

  // Apply Reciprocal Rank Fusion (RRF)
  const fusedResults = reciprocalRankFusion(vectorResults, textResults);

  // Return top results
  return fusedResults.slice(0, limit);
}

async function vectorSearch(
  collection: Awaited<ReturnType<typeof getDocumentsCollection>>,
  embedding: number[],
  filter: Record<string, unknown>,
  limit: number
): Promise<SearchResult[]> {
  const pipeline: object[] = [
    {
      $vectorSearch: {
        index: "vector_index",
        path: "embedding",
        queryVector: embedding,
        numCandidates: limit * 10,
        limit: limit,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      },
    },
    {
      $project: {
        text: 1,
        metadata: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();

  return results.map((doc) => ({
    text: doc.text,
    score: doc.score,
    metadata: doc.metadata,
  }));
}

async function textSearch(
  collection: Awaited<ReturnType<typeof getDocumentsCollection>>,
  query: string,
  filter: Record<string, unknown>,
  limit: number
): Promise<SearchResult[]> {
  const searchStage: Record<string, unknown> = {
    index: "text_index",
    text: {
      query: query,
      path: "text",
      fuzzy: {
        maxEdits: 1,
      },
    },
  };

  // Add compound filter if we have metadata filters
  if (Object.keys(filter).length > 0) {
    const filterClauses = Object.entries(filter).map(([path, value]) => ({
      equals: { path, value },
    }));

    searchStage.compound = {
      must: [
        {
          text: {
            query: query,
            path: "text",
            fuzzy: { maxEdits: 1 },
          },
        },
      ],
      filter: filterClauses,
    };
    delete searchStage.text;
  }

  const pipeline: object[] = [
    { $search: searchStage },
    { $limit: limit },
    {
      $project: {
        text: 1,
        metadata: 1,
        score: { $meta: "searchScore" },
      },
    },
  ];

  try {
    const results = await collection.aggregate(pipeline).toArray();
    return results.map((doc) => ({
      text: doc.text,
      score: doc.score,
      metadata: doc.metadata,
    }));
  } catch (error) {
    // Text search index might not exist yet
    console.warn("Text search failed, falling back to empty results:", error);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion (RRF) to combine results from multiple search methods
 * k=60 is the standard constant used in RRF
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  textResults: SearchResult[]
): SearchResult[] {
  const k = 60;
  const scoreMap = new Map<string, { result: SearchResult; score: number }>();

  // Score from vector search
  vectorResults.forEach((result, rank) => {
    const key = `${result.metadata.filename}:${result.metadata.row_index}`;
    const rrfScore = 1 / (k + rank + 1);
    scoreMap.set(key, { result, score: rrfScore });
  });

  // Add scores from text search
  textResults.forEach((result, rank) => {
    const key = `${result.metadata.filename}:${result.metadata.row_index}`;
    const rrfScore = 1 / (k + rank + 1);

    if (scoreMap.has(key)) {
      scoreMap.get(key)!.score += rrfScore;
    } else {
      scoreMap.set(key, { result, score: rrfScore });
    }
  });

  // Sort by combined score and return
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}

/**
 * Insert chunks into the documents collection
 */
export async function insertChunks(
  chunks: Omit<DocumentChunk, "_id">[]
): Promise<number> {
  if (chunks.length === 0) {
    return 0;
  }

  const collection = await getDocumentsCollection();
  const result = await collection.insertMany(chunks as DocumentChunk[]);
  return result.insertedCount;
}

/**
 * Delete all chunks for a specific filename
 */
export async function deleteByFilename(filename: string): Promise<number> {
  const collection = await getDocumentsCollection();
  const result = await collection.deleteMany({ "metadata.filename": filename });
  return result.deletedCount;
}

/**
 * List all unique documents (files) with their metadata
 */
export async function listDocuments(): Promise<DocumentInfo[]> {
  const collection = await getDocumentsCollection();

  const pipeline = [
    {
      $group: {
        _id: "$metadata.filename",
        restaurant: { $first: "$metadata.restaurant" },
        csv_type: { $first: "$metadata.csv_type" },
        row_count: { $sum: 1 },
        uploaded_at: { $first: "$metadata.uploaded_at" },
      },
    },
    {
      $project: {
        _id: 0,
        filename: "$_id",
        restaurant: 1,
        csv_type: 1,
        row_count: 1,
        uploaded_at: 1,
      },
    },
    {
      $sort: { uploaded_at: -1 },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();

  return results as unknown as DocumentInfo[];
}
