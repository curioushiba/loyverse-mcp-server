# MongoDB Atlas Index Configuration

This document explains how to set up the required MongoDB Atlas indexes for the RAG (Retrieval-Augmented Generation) system.

## Prerequisites

1. A MongoDB Atlas account (free M0 tier works!)
2. A cluster created with your connection string configured in `MONGODB_URI`
3. The database `loyverse_rag` will be created automatically when you first ingest a document

## Required Indexes

The RAG system uses **hybrid search** combining:
- **Vector Search** (semantic similarity using embeddings)
- **Full-Text Search** (keyword matching with fuzzy support)
- **Reciprocal Rank Fusion (RRF)** to combine results

You need to create **two indexes** on the `chunks` collection.

---

## Step 1: Create the Vector Search Index

This index enables semantic search using 1536-dimensional OpenAI embeddings.

### Using MongoDB Atlas UI

1. Go to your cluster in MongoDB Atlas
2. Click on "Atlas Search" in the left sidebar
3. Click "Create Search Index"
4. Choose "JSON Editor"
5. Select the `loyverse_rag` database and `chunks` collection
6. Name the index: `vector_index`
7. Paste this configuration:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "restaurant"
    }
  ]
}
```

8. Click "Create Search Index"

### Using MongoDB CLI

```bash
mongosh "your-connection-string" --eval '
db.getSiblingDB("loyverse_rag").runCommand({
  createSearchIndexes: "chunks",
  indexes: [{
    name: "vector_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: 1536,
          similarity: "cosine"
        },
        {
          type: "filter",
          path: "restaurant"
        }
      ]
    }
  }]
})
'
```

---

## Step 2: Create the Text Search Index

This index enables keyword search with fuzzy matching.

### Using MongoDB Atlas UI

1. Go to your cluster in MongoDB Atlas
2. Click on "Atlas Search" in the left sidebar
3. Click "Create Search Index"
4. Choose "JSON Editor"
5. Select the `loyverse_rag` database and `chunks` collection
6. Name the index: `text_index`
7. Paste this configuration:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "content": {
        "type": "string",
        "analyzer": "lucene.standard"
      },
      "restaurant": {
        "type": "string"
      },
      "metadata": {
        "type": "document",
        "fields": {
          "title": {
            "type": "string",
            "analyzer": "lucene.standard"
          },
          "type": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

8. Click "Create Search Index"

### Using MongoDB CLI

```bash
mongosh "your-connection-string" --eval '
db.getSiblingDB("loyverse_rag").runCommand({
  createSearchIndexes: "chunks",
  indexes: [{
    name: "text_index",
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          content: {
            type: "string",
            analyzer: "lucene.standard"
          },
          restaurant: {
            type: "string"
          },
          metadata: {
            type: "document",
            fields: {
              title: {
                type: "string",
                analyzer: "lucene.standard"
              },
              type: {
                type: "string"
              }
            }
          }
        }
      }
    }
  }]
})
'
```

---

## Step 3: Verify Index Status

After creating the indexes, wait 1-5 minutes for them to build. You can check their status:

1. Go to "Atlas Search" in MongoDB Atlas
2. Both `vector_index` and `text_index` should show status "Active"

---

## How Hybrid Search Works

When you call `rag_search`, the system:

1. **Generates an embedding** for your query using the local `all-MiniLM-L6-v2` model (384 dimensions)

2. **Runs two parallel searches:**
   - `$vectorSearch`: Finds semantically similar content
   - `$search`: Finds keyword matches with fuzzy tolerance

3. **Applies Reciprocal Rank Fusion (RRF):**
   ```
   RRF_score = 1/(k + rank_vector) + 1/(k + rank_text)
   ```
   Where `k=60` is the smoothing constant.

4. **Returns combined results** ranked by RRF score

This approach excels at finding:
- **Concepts**: "How do I clean the fryer?" (semantic)
- **Exact terms**: "Error Code E-04" or "Part #FR-2847" (keyword)
- **Combined**: "fryer cleaning procedure" matches both!

---

## Troubleshooting

### "Index not found" error
- Ensure both indexes are in "Active" status
- Check that index names match exactly: `vector_index` and `text_index`
- Verify the database name is `loyverse_rag` and collection is `chunks`

### Slow search performance
- The free M0 tier has limited resources
- Consider upgrading to M2+ for production workloads
- Reduce `numCandidates` in vector search if needed

### Empty search results
- Ensure documents have been ingested with `rag_ingest`
- Check the `restaurant` filter matches your data
- Try broader search terms

---

## Collection Schema Reference

### `chunks` collection

```typescript
{
  _id: ObjectId,
  document_id: string,      // Links to parent document
  restaurant: string,       // Restaurant identifier (filtered in searches)
  content: string,          // The chunk text content
  embedding: number[],      // 384-dimensional vector
  metadata: {
    type: "menu" | "recipe" | "sop" | "policy" | "manual" | "other",
    title: string,
    section?: string,
    tags?: string[]
  },
  chunk_index: number,      // Position within document
  created_at: Date
}
```

### `documents` collection

```typescript
{
  _id: ObjectId,
  document_id: string,      // Unique document ID
  restaurant: string,       // Restaurant identifier
  title: string,            // Document title
  type: string,             // Document type
  content: string,          // Full original content
  chunk_count: number,      // Number of chunks created
  created_at: Date
}
```

---

## Cost Considerations

| Tier | Storage | Vector Dimensions | Monthly Cost |
|------|---------|-------------------|--------------|
| M0 (Free) | 512 MB | Up to 4096 | $0 |
| M2 | 2 GB | Up to 4096 | ~$9 |
| M5 | 5 GB | Up to 4096 | ~$25 |

The free M0 tier is sufficient for:
- ~10,000 document chunks
- Basic hybrid search
- Development and testing

For production with >50,000 chunks, consider M2 or higher.
