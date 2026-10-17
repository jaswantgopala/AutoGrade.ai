import { GoogleGenAI } from '@google/genai';

export class GeminiError extends Error {
  constructor(
    public code: number,
    public message: string
  ) {
    super(message);
  }
}
let geminiClient: GoogleGenAI | null = null;

/**
 * Initialize Gemini AI client with API key from environment
 * @returns Initialized GoogleGenAI client
 * @throws GeminiError if API key is not configured
 */
export function initializeGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new GeminiError(
      500,
      'Gemini API key is not configured. Set GEMINI_API_KEY environment variable.'
    );
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}

/**
 * Get the Gemini AI client instance
 * @returns Initialized GoogleGenAI client
 * @throws GeminiError if client is not initialized
 */
export function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    return initializeGemini();
  }
  return geminiClient;
}

/**
 * Verify Gemini connectivity and configuration
 * @returns boolean indicating if Gemini is properly configured
 */
export function isGeminiConfigured(): boolean {
  try {
    getGeminiClient();
    return true;
  } catch (error) {
    console.error('Gemini configuration check failed:', error);
    return false;
  }
}
