import { ModelClient } from '../modelClient.js';
import { TRIANGULATION_MODELS, TRIANGULATION_TIMEOUTS } from '@glyphor/shared';
import type { QueryTier } from '@glyphor/shared';
import type { ConversationAttachment } from '../types.js';

export interface ProviderResponse {
  provider: 'claude' | 'gemini' | 'openai';
  text: string;
  latencyMs: number;
  tokenUsage: { input: number; output: number; thinking: number };
  status: 'success' | 'error';
  error?: string;
}

interface FanOutOptions {
  enableWebSearch?: boolean;
  attachments?: Array<{ name: string; mimeType: string; base64: string }>;
  maxOutputTokens?: number;
}

/** Map caller attachments (base64 field) to ConversationAttachment (data field). */
function toConversationAttachments(
  attachments?: FanOutOptions['attachments'],
): ConversationAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map(({ name, mimeType, base64 }) => ({ name, mimeType, data: base64 }));
}

const MODEL_TO_PROVIDER: Record<string, ProviderResponse['provider']> = {
  [TRIANGULATION_MODELS.primary]: 'claude',
  [TRIANGULATION_MODELS.validator1]: 'gemini',
  [TRIANGULATION_MODELS.validator2]: 'openai',
};

export async function fanOut(
  message: string,
  systemPrompt: string,
  tier: QueryTier,
  modelClient: ModelClient,
  options?: FanOutOptions,
): Promise<ProviderResponse[]> {
  const timeout =
    tier === 'DEEP'
      ? TRIANGULATION_TIMEOUTS.deep
      : TRIANGULATION_TIMEOUTS.standard;

  const models = [
    TRIANGULATION_MODELS.primary,
    TRIANGULATION_MODELS.validator1,
    TRIANGULATION_MODELS.validator2,
  ] as const;

  const contents = [
    {
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
      attachments: toConversationAttachments(options?.attachments),
    },
  ];

  const calls = models.map((model) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = performance.now();

    const maxTokens =
      model === TRIANGULATION_MODELS.validator1
        ? Math.min(options?.maxOutputTokens ?? 16384, 64000)
        : (options?.maxOutputTokens ?? 16384);

    const promise = modelClient
      .generate({
        model,
        systemInstruction: systemPrompt,
        contents,
        maxTokens,
        thinkingEnabled: tier === 'DEEP',
        signal: controller.signal,
        callTimeoutMs: timeout,
      })
      .then((result) => {
        clearTimeout(timer);
        return {
          provider: MODEL_TO_PROVIDER[model],
          text: result.text ?? '',
          latencyMs: Math.round(performance.now() - start),
          tokenUsage: {
            input: result.usageMetadata.inputTokens,
            output: result.usageMetadata.outputTokens,
            thinking: result.usageMetadata.thinkingTokens ?? 0,
          },
          status: 'success' as const,
        };
      })
      .catch((reason: Error) => {
        clearTimeout(timer);
        return {
          provider: MODEL_TO_PROVIDER[model],
          text: '',
          latencyMs: Math.round(performance.now() - start),
          tokenUsage: { input: 0, output: 0, thinking: 0 },
          status: 'error' as const,
          error: reason.message,
        };
      });

    return promise;
  });

  const results = await Promise.allSettled(calls);

  // Inner promises handle their own errors, so all results are fulfilled
  return results.map((r) => (r as PromiseFulfilledResult<ProviderResponse>).value);
}
