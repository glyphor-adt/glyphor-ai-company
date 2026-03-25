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
import { getTierModel } from '@glyphor/shared';

// ─── Re-export types for backward compatibility ──────────────

export type { ModelProvider, ImageResponse };
export type ModelClientConfig = ProviderFactoryConfig;
export type ModelRequest = UnifiedModelRequest;
export type ModelResponse = UnifiedModelResponse;

// ─── Provider detection ──────────────────────────────────────

export function detectProvider(model: string): ModelProvider {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('deep-research-')) return 'gemini';
  if (model === 'model-router' || model.startsWith('model-router')) return 'openai';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model)) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}". Expected prefix: gemini-, deep-research-, gpt-, o1/o3/o4, model-router, or claude-`);
}

/** Detect quota/rate-limit errors across all providers. */
function isQuotaError(msg: string): boolean {
  return /429|rate.?limit|quota|resource.?exhausted|too many requests|capacity|overloaded/i.test(msg);
}

function sanitizeToolsForProvider(
  provider: ModelProvider,
  tools: ModelRequest['tools'],
): ModelRequest['tools'] {
  if (!tools?.length) return tools;

  if (provider === 'gemini') {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.parameters),
    }));
  }

  return tools.map((tool) => ({
    ...tool,
    parameters: structuredClone(tool.parameters),
  }));
}

// ─── ModelClient ─────────────────────────────────────────────

export class ModelClient {
  private factory: ProviderFactory;
  private static readonly DETERMINISTIC_FALLBACK_MODEL = getTierModel('default');
  private static readonly BLOCKED_PROVIDER_PREFIXES = ['claude-'] as const;
  private static readonly DEFAULT_DEEP_RESEARCH_TIMEOUT_MS = 30 * 60 * 1000;

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
    const normalizedRequestedModel = request.model === '__deterministic__'
      ? ModelClient.DETERMINISTIC_FALLBACK_MODEL
      : request.model;
    if (normalizedRequestedModel !== request.model) {
      console.warn(
        `[ModelClient] Received sentinel model "${request.model}"; using fallback model ${normalizedRequestedModel}`,
      );
      request = { ...request, model: normalizedRequestedModel };
    }

    const requestedModel = normalizedRequestedModel;
    if (requestedModel.startsWith('deep-research-')) {
      return this.generateWithDeepResearch(requestedModel, request);
    }

    const isBlockedRequestedModel = ModelClient.BLOCKED_PROVIDER_PREFIXES.some((prefix) => requestedModel.startsWith(prefix));
    const effectiveRequestedModel = isBlockedRequestedModel
      ? ModelClient.DETERMINISTIC_FALLBACK_MODEL
      : requestedModel;
    if (isBlockedRequestedModel) {
      console.warn(
        `[ModelClient] Direct Anthropic execution is disabled; remapping ${requestedModel} -> ${effectiveRequestedModel}`,
      );
      request = { ...request, model: effectiveRequestedModel };
    }

    const agentRole = request.metadata?.agentRole;
    // Atlas (ops): agent runners pass same-provider to stay on one vendor, but Gemini fallbacks
    // hit tool-schema / thought_signature errors. Use cross-provider + Gemini-free chain instead.
    const fallbackScope = request.fallbackScope ?? 'cross-provider';
    const effectiveScope =
      agentRole === 'ops' ? 'cross-provider' : fallbackScope;
    const fallbackChain =
      effectiveScope === 'none'
        ? []
        : effectiveScope === 'same-provider'
          ? getProviderLocalFallbackChain(effectiveRequestedModel, agentRole)
          : getFallbackChain(effectiveRequestedModel, agentRole);
    const modelsToTry = [effectiveRequestedModel, ...fallbackChain].filter(
      (modelId, idx, arr) => !modelId.startsWith('claude-') && arr.indexOf(modelId) === idx,
    );
    if (modelsToTry.length === 0) {
      throw new Error('No eligible models remain after applying provider policy constraints.');
    }
    let lastFailureDetail = '';

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

      // Strip previousResponseId on fallback — it belongs to a different
      // model's server-side state and would cause 400 errors.
      if (modelIdx > 0 && request.metadata?.previousResponseId) {
        request = { ...request, metadata: { ...request.metadata, previousResponseId: undefined } };
      }

      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const sanitizedTools = sanitizeToolsForProvider(provider, request.tools);
          const apiPromise = adapter.generate({
            ...request,
            model: currentModel,
            ...(sanitizedTools ? { tools: sanitizedTools } : {}),
          });
          const response = await this.raceAbort(apiPromise, request.signal, request.callTimeoutMs);
          if (modelIdx > 0) {
            console.warn(`[ModelClient] Fallback success: ${request.model} → ${currentModel}`);
          }
          return {
            ...response,
            actualModel: currentModel,
            actualProvider: provider,
          };
        } catch (err) {
          const msg = (err as Error).message ?? '';
          const cause = (err as { cause?: Error }).cause?.message;
          const rawDetail = cause ? `${msg} (cause: ${cause})` : msg;
          // Strip any API keys or tokens from error messages to prevent leaking secrets
          const detail = rawDetail.replace(/sk-ant-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]+/g, '[REDACTED]');
          lastFailureDetail = `[${currentModel}] ${detail}`;
          if (request.signal?.aborted) throw err;

          // Auth errors (401/403) — non-retryable, affects all models in provider
          if (/40[12]|403/.test(msg) && !isQuotaError(msg)) {
            throw new Error(`[${provider}] ${detail} (model: ${currentModel})`);
          }

          // Model-level errors (400/404/422) — skip to next fallback model
          if (/400|404|422/.test(msg) && !isQuotaError(msg)) {
            if (modelIdx < modelsToTry.length - 1) {
              console.warn(`[ModelClient] ${currentModel} returned ${msg.match(/40[04]|422/)?.[0] ?? 'client error'}, trying fallback ${modelsToTry[modelIdx + 1]}`);
              break; // break retry loop → try next model
            }
            throw new Error(`[${provider}] ${detail} (model: ${currentModel})`);
          }

          // Quota/rate-limit error — skip retries on this model, move to fallback
          if (isQuotaError(msg)) {
            console.warn(`[ModelClient] Quota/rate-limit on ${currentModel}: ${detail}`);
            if (modelIdx >= modelsToTry.length - 1) {
              throw new Error(
                `Exhausted model fallback chain after quota/rate-limit on final model. ${lastFailureDetail}`,
              );
            }
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
    throw new Error(
      lastFailureDetail
        ? `Exhausted model fallback chain. Last error: ${lastFailureDetail}`
        : 'Unexpected: exhausted all models in fallback chain',
    );
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
    const PER_CALL_TIMEOUT_MS = callTimeoutMs ?? 300_000;
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

  private getGeminiApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_AI_API_KEY for Gemini Deep Research calls.');
    }
    return apiKey;
  }

  private async generateWithDeepResearch(model: string, request: ModelRequest): Promise<ModelResponse> {
    const prompt = [request.systemInstruction, request.contents.map((c) => c.content).join('\n\n')]
      .filter(Boolean)
      .join('\n\n');

    const previousInteractionId = request.metadata?.previousResponseId;
    const interactionId = await this.startDeepResearchInteraction(model, prompt, previousInteractionId);
    const text = await this.pollDeepResearchResult(interactionId, request.callTimeoutMs, request.signal);

    return {
      text,
      toolCalls: [],
      usageMetadata: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      actualModel: model,
      actualProvider: 'gemini',
      responseId: interactionId,
    };
  }

  private async startDeepResearchInteraction(model: string, prompt: string, previousInteractionId?: string): Promise<string> {
    const apiKey = this.getGeminiApiKey();
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        input: prompt,
        agent: model,
        background: true,
        store: true,
        ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deep Research interaction create failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error('Deep Research interaction create returned no interaction id.');
    }
    return payload.id;
  }

  private async pollDeepResearchResult(interactionId: string, callTimeoutMs?: number, signal?: AbortSignal): Promise<string> {
    const apiKey = this.getGeminiApiKey();
    const timeoutMs = callTimeoutMs ?? ModelClient.DEFAULT_DEEP_RESEARCH_TIMEOUT_MS;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) {
        const reason = (signal.reason as Error)?.message || 'signal aborted';
        throw new Error(`Aborted: ${reason}`);
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Deep Research interaction poll failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as {
        status?: string;
        error?: unknown;
        outputs?: Array<{ text?: string; content?: { text?: string } }>;
      };

      if (payload.status === 'completed') {
        const last = payload.outputs?.[payload.outputs.length - 1];
        const text = last?.text || last?.content?.text || '';
        if (!text) throw new Error('Deep Research interaction completed without textual output.');
        return text;
      }

      if (payload.status === 'failed') {
        throw new Error(`Deep Research interaction failed: ${JSON.stringify(payload.error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    throw new Error('Deep Research interaction timed out before completion.');
  }
}
