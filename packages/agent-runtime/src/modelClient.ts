/**
 * Model Client — Multi-provider LLM wrapper (Gemini, OpenAI, Anthropic)
 *
 * Delegates to per-provider adapters in ./providers/ while maintaining
 * the original ModelRequest/ModelResponse contract for backward compatibility.
 *
 * The provider is determined by the model name prefix:
 *   - gemini-*    → Google Gemini (@google/genai)
 *   - gpt-*, o1-*, o3-*, o4-* → OpenAI (openai)
 *   - claude-*    → Anthropic (@anthropic-ai/sdk)
 */

import { ProviderFactory, type ProviderFactoryConfig, type GeminiAdapter, type OpenAIAdapter } from './providers/index.js';
import type { ModelProvider, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './providers/types.js';

// ─── Re-export types for backward compatibility ──────────────

export type { ModelProvider, ImageResponse };
export type ModelClientConfig = ProviderFactoryConfig;
export type ModelRequest = UnifiedModelRequest;
export type ModelResponse = UnifiedModelResponse;

// ─── Provider detection ──────────────────────────────────────

export function detectProvider(model: string): ModelProvider {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-') || model.startsWith('o4-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}". Expected prefix: gemini-, gpt-, o1-, o3-, o4-, or claude-`);
}

// ─── ModelClient ─────────────────────────────────────────────

export class ModelClient {
  private factory: ProviderFactory;

  constructor(config: ModelClientConfig | string) {
    // Backwards-compatible: if a plain string is passed, treat as Gemini API key
    if (typeof config === 'string') {
      this.factory = new ProviderFactory({ geminiApiKey: config });
      return;
    }
    this.factory = new ProviderFactory(config);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal?.aborted) {
      const reason = (request.signal.reason as Error)?.message || 'signal aborted';
      throw new Error(`Aborted: ${reason}`);
    }

    const provider = detectProvider(request.model);
    const adapter = this.factory.get(provider);
    const MAX_RETRIES = 1;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const apiPromise = adapter.generate(request);
        return await this.raceAbort(apiPromise, request.signal, request.callTimeoutMs);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (request.signal?.aborted) throw err;
        if (/40[0-3]|404|422/.test(msg)) throw err;
        if (attempt < MAX_RETRIES) {
          const backoffMs = 2000 * (attempt + 1);
          console.warn(`[ModelClient] Attempt ${attempt + 1} failed (${msg}), retrying in ${backoffMs}ms…`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Unexpected: exhausted retries');
  }

  /**
   * Generate an image using Google Imagen 4 Ultra.
   */
  async generateImage(prompt: string, model = 'imagen-4.0-ultra-generate-001'): Promise<ImageResponse> {
    const adapter = this.factory.get('gemini') as GeminiAdapter;
    return adapter.generateImage(prompt, model);
  }

  /**
   * Generate an image using OpenAI gpt-image-1 (text-rich infographics).
   */
  async generateImageOpenAI(prompt: string, model = 'gpt-image-1'): Promise<ImageResponse> {
    const adapter = this.factory.get('openai') as OpenAIAdapter;
    return adapter.generateImage(prompt, model);
  }

  // ─── Shared helpers ──────────────────────────────────────

  private async raceAbort<T>(promise: Promise<T>, signal?: AbortSignal, callTimeoutMs?: number): Promise<T> {
    const PER_CALL_TIMEOUT_MS = callTimeoutMs ?? 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT_MS);

    const signals = signal
      ? [signal, timeoutSignal]
      : [timeoutSignal];

    const abortPromise = new Promise<never>((_, reject) => {
      for (const sig of signals) {
        const onAbort = () => {
          const reason = sig === timeoutSignal
            ? `API call timed out after ${PER_CALL_TIMEOUT_MS}ms`
            : (sig.reason as Error)?.message || 'signal aborted';
          reject(new Error(`Aborted: ${reason}`));
        };
        if (sig.aborted) {
          onAbort();
          return;
        }
        sig.addEventListener('abort', onAbort, { once: true });
      }
    });

    return Promise.race([promise, abortPromise]);
  }
}
