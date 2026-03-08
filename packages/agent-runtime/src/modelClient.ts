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
import { getFallbackChain, getProviderLocalFallbackChain } from '@glyphor/shared/models';

// ─── Re-export types for backward compatibility ──────────────

export type { ModelProvider, ImageResponse };
export type ModelClientConfig = ProviderFactoryConfig;
export type ModelRequest = UnifiedModelRequest;
export type ModelResponse = UnifiedModelResponse;

// ─── Provider detection ──────────────────────────────────────

export function detectProvider(model: string): ModelProvider {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}". Expected prefix: gemini-, gpt-, o1/o3/o4, or claude-`);
}

/** Detect quota/rate-limit errors across all providers. */
function isQuotaError(msg: string): boolean {
  return /429|rate.?limit|quota|resource.?exhausted|too many requests|capacity|overloaded/i.test(msg);
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

    // Try the requested model first, then fallback chain on quota/rate errors
    const fallbackScope = request.fallbackScope ?? 'cross-provider';
    const fallbackChain = fallbackScope === 'none'
      ? []
      : fallbackScope === 'same-provider'
        ? getProviderLocalFallbackChain(request.model)
        : getFallbackChain(request.model);
    const modelsToTry = [request.model, ...fallbackChain];

    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const currentModel = modelsToTry[modelIdx];
      const provider = detectProvider(currentModel);
      let adapter: import('./providers/types.js').ProviderAdapter;
      try {
        adapter = this.factory.get(provider);
      } catch {
        // Provider not configured (no API key) — skip to next fallback
        if (modelIdx < modelsToTry.length - 1) {
          console.warn(`[ModelClient] Provider ${provider} not configured, skipping ${currentModel}`);
          continue;
        }
        throw new Error(`[${provider}] No API key configured (model: ${currentModel})`);
      }

      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const apiPromise = adapter.generate({ ...request, model: currentModel });
          const response = await this.raceAbort(apiPromise, request.signal, request.callTimeoutMs);
          if (modelIdx > 0) {
            console.warn(`[ModelClient] Fallback success: ${request.model} → ${currentModel}`);
          }
          return response;
        } catch (err) {
          const msg = (err as Error).message ?? '';
          const cause = (err as { cause?: Error }).cause?.message;
          const detail = cause ? `${msg} (cause: ${cause})` : msg;
          if (request.signal?.aborted) throw err;

          // Non-retryable client errors (bad request, auth, not found) — no fallback
          if (/40[0-2]|403|404|422/.test(msg) && !isQuotaError(msg)) {
            throw new Error(`[${provider}] ${detail} (model: ${currentModel})`);
          }

          // Quota/rate-limit error — skip retries on this model, move to fallback
          if (isQuotaError(msg)) {
            console.warn(`[ModelClient] Quota/rate-limit on ${currentModel}: ${detail}`);
            break; // break retry loop → try next model in fallback chain
          }

          if (attempt < MAX_RETRIES) {
            const backoffMs = 2000 * (attempt + 1);
            console.warn(`[ModelClient] Attempt ${attempt + 1} for ${currentModel} failed (${detail}), retrying in ${backoffMs}ms…`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }

          // Exhausted retries on this model — try fallback if available
          if (modelIdx < modelsToTry.length - 1) {
            console.warn(`[ModelClient] ${currentModel} exhausted retries, falling back to ${modelsToTry[modelIdx + 1]}`);
            break; // break retry loop → try next model
          }

          throw new Error(`[${provider}] ${detail} (model: ${currentModel})`);
        }
      }
    }
    throw new Error('Unexpected: exhausted all models in fallback chain');
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
  async generateImageOpenAI(prompt: string, model = 'gpt-image-1.5-2025-12-16'): Promise<ImageResponse> {
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
