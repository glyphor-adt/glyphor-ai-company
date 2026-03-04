/**
 * Provider Factory — Creates and caches provider adapters.
 *
 * Usage:
 *   const factory = new ProviderFactory(config);
 *   const adapter = factory.get('gemini');
 *   const response = await adapter.generate(request);
 */

export { type ModelProvider, type UnifiedModelRequest, type UnifiedModelResponse, type UnifiedToolCall, type UnifiedUsageMetadata, type ImageResponse, type ProviderAdapter } from './types.js';
export { GeminiAdapter } from './gemini.js';
export { OpenAIAdapter } from './openai.js';
export { AnthropicAdapter } from './anthropic.js';

import type { ModelProvider, ProviderAdapter } from './types.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

export interface ProviderFactoryConfig {
  geminiApiKey?: string;
  openaiApiKey?: string;
  /** GCP project ID for Vertex AI (Claude via Vertex). Falls back to GCP_PROJECT_ID env var. */
  vertexProjectId?: string;
  /** GCP region for Vertex AI Claude. Defaults to us-east5. */
  vertexRegion?: string;
}

export class ProviderFactory {
  private adapters = new Map<ModelProvider, ProviderAdapter>();
  private config: ProviderFactoryConfig;

  constructor(config: ProviderFactoryConfig) {
    this.config = config;
  }

  get(provider: ModelProvider): ProviderAdapter {
    const cached = this.adapters.get(provider);
    if (cached) return cached;

    const adapter = this.create(provider);
    this.adapters.set(provider, adapter);
    return adapter;
  }

  private create(provider: ModelProvider): ProviderAdapter {
    switch (provider) {
      case 'gemini': {
        if (!this.config.geminiApiKey) throw new Error('Gemini API key not configured — set GOOGLE_AI_API_KEY environment variable');
        return new GeminiAdapter(this.config.geminiApiKey);
      }
      case 'openai': {
        if (!this.config.openaiApiKey) throw new Error('OpenAI API key not configured — set OPENAI_API_KEY environment variable');
        return new OpenAIAdapter(this.config.openaiApiKey);
      }
      case 'anthropic': {
        const projectId = this.config.vertexProjectId ?? process.env.GCP_PROJECT_ID;
        if (!projectId) throw new Error('GCP project ID not configured — set GCP_PROJECT_ID environment variable or pass vertexProjectId');
        return new AnthropicAdapter(projectId, this.config.vertexRegion);
      }
    }
  }
}
