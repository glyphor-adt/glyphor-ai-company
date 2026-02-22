/**
 * Embedding Client — generates vector embeddings via Google text-embedding-004.
 *
 * Used by CompanyMemoryStore to embed memories for semantic search.
 * Dimensions: 768 (matches the pgvector column).
 */

import { GoogleGenAI } from '@google/genai';

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

export class EmbeddingClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Generate an embedding vector for a single text string.
   * Returns a 768-dimensional float array.
   */
  async embed(text: string): Promise<number[]> {
    const result = await this.client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    return result.embeddings?.[0]?.values ?? [];
  }

  /**
   * Batch-embed multiple texts. Returns an array of 768-dim vectors.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results = await Promise.all(texts.map((t) => this.embed(t)));
    return results;
  }
}
