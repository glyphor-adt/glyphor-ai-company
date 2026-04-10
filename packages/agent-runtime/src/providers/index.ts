/**
 * Provider Factory — Creates and caches provider adapters.
 */

export { type ModelProvider, type UnifiedModelRequest, type UnifiedModelResponse, type UnifiedToolCall, type UnifiedUsageMetadata, type ImageResponse, type ProviderAdapter } from './types.js';
export { GeminiAdapter, type GeminiAdapterConfig } from './gemini.js';
export { OpenAIAdapter } from './openai.js';
export { BedrockAnthropicAdapter } from './bedrockAnthropic.js';
export { BedrockDeepSeekAdapter } from './bedrockDeepseek.js';
export { isBedrockEnabled, getBedrockRegion } from './bedrockClient.js';

import type { ModelProvider, ProviderAdapter } from './types.js';
import { GeminiAdapter, type GeminiAdapterConfig } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { BedrockAnthropicAdapter } from './bedrockAnthropic.js';
import { BedrockDeepSeekAdapter } from './bedrockDeepseek.js';
import { isBedrockEnabled } from './bedrockClient.js';

export interface ProviderFactoryConfig {
  geminiApiKey?: string;
  azureFoundryEndpoint?: string;
  azureFoundryApi?: string;
  azureFoundryApiVersion?: string;
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
        const directGeminiKey = (
          this.config.geminiApiKey
          ?? process.env.GOOGLE_AI_API_KEY
          ?? process.env.GEMINI_API_KEY
        )?.trim();

        if (!directGeminiKey) {
          throw new Error('Gemini not configured — set GOOGLE_AI_API_KEY or GEMINI_API_KEY');
        }
        return new GeminiAdapter({ apiKey: directGeminiKey });
      }
      case 'openai': {
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
        if (!(azureEndpoint && azureApiKey)) {
          throw new Error(
            'OpenAI provider is Azure-only — set AZURE_FOUNDRY_ENDPOINT+AZURE_FOUNDRY_API (or AZURE_OPENAI_*)',
          );
        }
        return new OpenAIAdapter({
          azureEndpoint,
          azureApiKey,
          azureApiVersion,
        });
      }
      case 'anthropic': {
        if (!isBedrockEnabled()) {
          throw new Error(
            'Claude requires Amazon Bedrock — set BEDROCK_ENABLED=true, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION',
          );
        }
        return new BedrockAnthropicAdapter();
      }
      case 'deepseek': {
        if (!isBedrockEnabled()) {
          throw new Error(
            'DeepSeek requires Amazon Bedrock — set BEDROCK_ENABLED=true, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION',
          );
        }
        return new BedrockDeepSeekAdapter();
      }
    }
  }
}
