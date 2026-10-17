import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAi from "openai";

dotenv.config();

let pineconeClient: Pinecone | null = null;
let pineconeIndexPromise: Promise<any> | null = null;

export function isVectorStoreEnabled(): boolean {
  const raw = (process.env.ENABLE_VECTOR_STORE || "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function extractIndexNames(listResponse: any): string[] {
  if (Array.isArray(listResponse)) {
    return listResponse
      .map((item) => (typeof item === "string" ? item : item?.name))
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  }

  if (Array.isArray(listResponse?.indexes)) {
    return listResponse.indexes
      .map((item: any) => item?.name)
      .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0);
  }

  return [];
}

async function getPineconeIndex() {
  if (!isVectorStoreEnabled()) {
    throw new Error("Vector store is disabled (ENABLE_VECTOR_STORE=false).");
  }

  const apiKey = process.env.PINECONE_API_KEY?.trim();
  const configuredIndexName =
    process.env.PINECONE_INDEX?.trim() ||
    process.env.PINECONE_INDEX_NAME?.trim();

  if (!apiKey) {
    throw new Error("PINECONE_API_KEY is missing. Add it to your .env file.");
  }

  if (!configuredIndexName) {
    throw new Error("PINECONE_INDEX is missing. Add PINECONE_INDEX (or PINECONE_INDEX_NAME) to your .env file.");
  }

  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey });
  }

  if (!pineconeIndexPromise) {
    pineconeIndexPromise = (async () => {
      let resolvedIndexName = configuredIndexName;

      try {
        const listResponse = await pineconeClient!.listIndexes();
        const availableIndexes = extractIndexNames(listResponse);

        if (availableIndexes.length > 0 && !availableIndexes.includes(configuredIndexName)) {
          resolvedIndexName = availableIndexes[0];
          console.warn(
            `Configured Pinecone index \"${configuredIndexName}\" was not found. Falling back to \"${resolvedIndexName}\".`
          );
        }
      } catch (error) {
        console.warn(
          "Could not validate Pinecone indexes via listIndexes; proceeding with configured index.",
          error instanceof Error ? error.message : error
        );
      }

      return pineconeClient!.index(resolvedIndexName);
    })();
  }

  return pineconeIndexPromise;
}

const client = new OpenAi({
    baseURL:"https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.GEMINI_API_KEY,
});

export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await client.embeddings.create({
      model: "gemini-embedding-001",
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    const status = (error as any)?.status;
    const message = (error as any)?.error?.message || (error as Error)?.message || "Unknown embedding error";
    if (status === 429 || String(message).toLowerCase().includes("spending cap")) {
      throw new Error(
        "Embedding service unavailable: spending cap exceeded (429). Continue grading with rubric/question or enable billing for embeddings."
      );
    }

    console.error("Embedding error:", error);
    throw error;
  }
}

export async function search(text: string) {
  const index = await getPineconeIndex();
  const embedding = await getEmbedding(text);

  const result = await index.query({
    vector: embedding,
    topK: 5,
    includeMetadata: true,
  });

  return result.matches;
}


export async function storeText(id: string, text: string) {
  const index = await getPineconeIndex();
  const embedding = await getEmbedding(text);

  await index.upsert({
    records: [
      {
        id,
        values: embedding,
        metadata: {
          text,
        },
      },
    ],
  });
}

export async function storeTextChunks(baseId: string, text: string, chunkSize = 1200): Promise<void> {
  const index = await getPineconeIndex();
  const normalized = (text || "").trim();
  if (!normalized) {
    return;
  }

  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += chunkSize) {
    chunks.push(normalized.slice(i, i + chunkSize));
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunks[i];
    const embedding = await getEmbedding(chunkText);

    await index.upsert({
      records: [
        {
          id: `${baseId}::chunk::${i}`,
          values: embedding,
          metadata: {
            text: chunkText,
            parentId: baseId,
            chunkIndex: i,
          },
        },
      ],
    });
  }
}

export async function getStoredTextById(id: string): Promise<string | null> {
  const index = await getPineconeIndex();
  const result: any = await index.query({
    id,
    topK: 1,
    includeMetadata: true,
  });

  const match = result?.matches?.find((item: any) => item.id === id) || result?.matches?.[0];
  const text = match?.metadata?.text;

  if (typeof text === 'string' && text.trim()) {
    return text;
  }

  return null;
}

export async function getRelevantTextByParentId(
  parentId: string,
  queryText: string,
  topK = 3
): Promise<string> {
  const index = await getPineconeIndex();
  if (!queryText.trim()) {
    return "";
  }

  const embedding = await getEmbedding(queryText);
  const result: any = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter: {
      parentId: { $eq: parentId },
    },
  });

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const texts = matches
    .map((match: any) => match?.metadata?.text)
    .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0);

  return texts.join("\n\n");
}