import { Pinecone } from '@pinecone-database/pinecone';

export class PineconeError extends Error {
  constructor(
    public code: number,
    public message: string
  ) {
    super(message);
  }
}

let pineconeClient: Pinecone | null = null;

/**
 * Initialize Pinecone client with API key from environment
 * @returns Initialized Pinecone client
 * @throws PineconeError if API key is not configured
 */
export function initializePinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new PineconeError(
      500,
      'Pinecone API key is not configured. Set PINECONE_API_KEY environment variable.'
    );
  }

  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey,
    });
  }

  return pineconeClient;
}

/**
 * Get the Pinecone client instance
 * @returns Initialized Pinecone client
 * @throws PineconeError if client is not initialized
 */
export function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    return initializePinecone();
  }
  return pineconeClient;
}

/**
 * Get a specific Pinecone index by name
 * @param indexName Name of the index to retrieve
 * @returns Pinecone index instance
 * @throws PineconeError if client is not initialized or index name is missing
 */
export function getPineconeIndex(indexName: string) {
  if (!indexName) {
    throw new PineconeError(400, 'Index name is required.');
  }

  const client = getPineconeClient();
  return client.Index(indexName);
}

/**
 * Verify Pinecone connectivity and configuration
 * @returns boolean indicating if Pinecone is properly configured
 */
export async function isPineconeConfigured(): Promise<boolean> {
  try {
    const client = getPineconeClient();
    // Try to list indexes to verify connectivity
    await client.listIndexes();
    return true;
  } catch (error) {
    console.error('Pinecone configuration check failed:', error);
    return false;
  }
}
