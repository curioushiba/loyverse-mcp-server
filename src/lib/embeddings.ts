import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn("Warning: OPENAI_API_KEY environment variable not set");
}

// Lazy-initialize OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Generate embedding for a single text using OpenAI text-embedding-3-small
 * Returns a 1536-dimension vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call
 * More efficient for batch processing
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const openai = getOpenAI();

  // OpenAI allows up to 2048 inputs per request, but we'll batch conservatively
  const BATCH_SIZE = 100;
  const BATCH_DELAY_MS = 100; // Delay between batches to avoid rate limits
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    // Add delay between batches (not before the first batch)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });

    // Embeddings are returned in the same order as input
    const batchEmbeddings = response.data.map((d) => d.embedding);
    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}
