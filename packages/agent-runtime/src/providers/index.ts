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
  openaiApiKey?: string;
  /** Azure Foundry endpoint, e.g. https://my-resource.openai.azure.com */
  azureFoundryEndpoint?: string;
  /** Azure Foundry API key. When set with azureFoundryEndpoint, routes OpenAI calls through Azure. */
  azureFoundryApi?: string;
  /** Azure Foundry API version (default: 2025-04-01-preview) */
  azureFoundryApiVersion?: string;
  /** Direct Anthropic API key. */
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
        const directGeminiKey = (this.config.geminiApiKey ?? process.env.GOOGLE_AI_API_KEY)?.trim();

        if (!directGeminiKey) throw new Error('Gemini not configured — set GOOGLE_AI_API_KEY for direct access');
        return new GeminiAdapter({ apiKey: directGeminiKey });
      }
      case 'openai': {
        const openaiApiKey = (this.config.openaiApiKey ?? process.env.OPENAI_API_KEY)?.trim();
        // Azure OpenAI / Foundry — from config or same env vars as webSearch / voice-gateway
        const azureEndpoint =
          this.config.azureFoundryEndpoint?.trim() ||
          process.env.AZURE_FOUNDRY_ENDPOINT?.trim() ||
          process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
          undefined;
        const azureApiKey =
          this.config.azureFoundryApi?.trim() ||
          process.env.AZURE_FOUNDRY_API?.trim() ||
          process.env.AZURE_OPENAI_API_KEY?.trim() ||
          undefined;
        const azureApiVersion =
          this.config.azureFoundryApiVersion?.trim() ||
          process.env.AZURE_FOUNDRY_API_VERSION?.trim() ||
          process.env.AZURE_OPENAI_API_VERSION?.trim() ||
          undefined;
        const hasAzure = !!(azureEndpoint && azureApiKey);
        if (!hasAzure && !openaiApiKey) {
          throw new Error(
            'OpenAI not configured — set OPENAI_API_KEY for direct, or AZURE_FOUNDRY_ENDPOINT+AZURE_FOUNDRY_API (or AZURE_OPENAI_*) for Azure',
          );
        }
        return new OpenAIAdapter({
          apiKey: openaiApiKey,
          azureEndpoint,
          azureApiKey,
          azureApiVersion,
        });
      }
      case 'anthropic': {
        const anthropicApiKey = (this.config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY)?.trim();
        if (!anthropicApiKey) throw new Error('Anthropic not configured — set ANTHROPIC_API_KEY environment variable');
        return new AnthropicAdapter(anthropicApiKey);
      }
    }
  }
}
