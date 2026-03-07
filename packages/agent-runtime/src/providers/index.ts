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
  /** Azure Foundry endpoint, e.g. https://my-resource.openai.azure.com */
  azureFoundryEndpoint?: string;
  /** Azure Foundry API key. When set with azureFoundryEndpoint, routes OpenAI calls through Azure. */
  azureFoundryApi?: string;
  /** Azure Foundry API version (default: 2025-04-01-preview) */
  azureFoundryApiVersion?: string;
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
        // Auto-detect Azure OpenAI from config or environment
        const azureEndpoint = this.config.azureFoundryEndpoint ?? process.env.AZURE_FOUNDRY_ENDPOINT;
        const azureApiKey = this.config.azureFoundryApi ?? process.env.AZURE_FOUNDRY_API;
        const hasAzure = !!(azureEndpoint && azureApiKey);
        if (!hasAzure && !this.config.openaiApiKey) {
          throw new Error('OpenAI not configured — set AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_API for Azure, or OPENAI_API_KEY for direct');
        }
        return new OpenAIAdapter({
          apiKey: this.config.openaiApiKey,
          azureEndpoint,
          azureApiKey,
          azureApiVersion: this.config.azureFoundryApiVersion,
        });
      }
      case 'anthropic': {
        const projectId = this.config.vertexProjectId ?? process.env.GCP_PROJECT_ID;
        if (!projectId) throw new Error('GCP project ID not configured — set GCP_PROJECT_ID environment variable or pass vertexProjectId');
        return new AnthropicAdapter(projectId, this.config.vertexRegion);
      }
    }
  }
}
