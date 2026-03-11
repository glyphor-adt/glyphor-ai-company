/**
 * Provider Factory — Creates and caches provider adapters.
 *
 * Usage:
 *   const factory = new ProviderFactory(config);
 *   const adapter = factory.get('gemini');
 *   const response = await adapter.generate(request);
 */

export { type ModelProvider, type UnifiedModelRequest, type UnifiedModelResponse, type UnifiedToolCall, type UnifiedUsageMetadata, type ImageResponse, type ProviderAdapter } from './types.js';
export { GeminiAdapter, type GeminiAdapterConfig } from './gemini.js';
export { OpenAIAdapter } from './openai.js';
export { AnthropicAdapter } from './anthropic.js';

import type { ModelProvider, ProviderAdapter } from './types.js';
import { GeminiAdapter, type GeminiAdapterConfig } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

export interface ProviderFactoryConfig {
  geminiApiKey?: string;
  /** GCP project ID — used for Vertex AI (Gemini + Claude). Preferred over geminiApiKey when set. */
  vertexProjectId?: string;
  /** GCP region for Vertex AI Gemini. Defaults to us-central1. */
  vertexLocation?: string;
  openaiApiKey?: string;
  /** Azure Foundry endpoint, e.g. https://my-resource.openai.azure.com */
  azureFoundryEndpoint?: string;
  /** Azure Foundry API key. When set with azureFoundryEndpoint, routes OpenAI calls through Azure. */
  azureFoundryApi?: string;
  /** Azure Foundry API version (default: 2025-04-01-preview) */
  azureFoundryApiVersion?: string;
  /** GCP region for Vertex AI Claude. Defaults to us-east5. */
  vertexRegion?: string;
  /** Direct Anthropic API key — used as fallback when Vertex AI quota is exhausted. */
  anthropicApiKey?: string;
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
        // Prefer Vertex AI (uses service account credentials) over direct API key
        const geminiProjectId = this.config.vertexProjectId ?? process.env.GCP_PROJECT_ID;
        if (geminiProjectId) {
          return new GeminiAdapter({
            vertexProjectId: geminiProjectId,
            vertexLocation: this.config.vertexLocation ?? process.env.VERTEX_LOCATION ?? 'us-central1',
          });
        }
        if (!this.config.geminiApiKey) throw new Error('Gemini not configured — set GCP_PROJECT_ID for Vertex AI or GOOGLE_AI_API_KEY for direct');
        return new GeminiAdapter({ apiKey: this.config.geminiApiKey });
      }
      case 'openai': {
        const openaiApiKey = this.config.openaiApiKey ?? process.env.OPENAI_API_KEY;
        // Azure OpenAI — only use if explicitly configured (not auto-detected from env)
        const azureEndpoint = this.config.azureFoundryEndpoint?.trim() || undefined;
        const azureApiKey = this.config.azureFoundryApi?.trim() || undefined;
        const hasAzure = !!(azureEndpoint && azureApiKey);
        if (!hasAzure && !openaiApiKey) {
          throw new Error('OpenAI not configured — set OPENAI_API_KEY for direct, or pass azureFoundryEndpoint + azureFoundryApi for Azure');
        }
        return new OpenAIAdapter({
          apiKey: openaiApiKey,
          azureEndpoint,
          azureApiKey,
          azureApiVersion: this.config.azureFoundryApiVersion,
        });
      }
      case 'anthropic': {
        const anthropicApiKey = this.config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) throw new Error('Anthropic not configured — set ANTHROPIC_API_KEY environment variable');
        const anthropicProjectId = this.config.vertexProjectId ?? process.env.GCP_PROJECT_ID;
        return new AnthropicAdapter(anthropicProjectId ?? '', this.config.vertexRegion, anthropicApiKey);
      }
    }
  }
}
