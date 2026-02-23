/**
 * Model Client — Multi-provider LLM wrapper (Gemini, OpenAI, Anthropic)
 *
 * Provides a unified interface over multiple LLM providers.
 * The provider is determined by the model name prefix:
 *   - gemini-*    → Google Gemini (@google/genai)
 *   - gpt-*, o1-*, o3-* → OpenAI (openai)
 *   - claude-*    → Anthropic (@anthropic-ai/sdk)
 *
 * Originally Gemini-only (ported from Fuse V7). Extended to support
 * OpenAI and Anthropic while keeping the same ModelRequest/ModelResponse contract.
 */

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, GeminiToolDeclaration } from './types.js';

// ─── Public types ────────────────────────────────────────────

export type ModelProvider = 'gemini' | 'openai' | 'anthropic';

export interface ModelClientConfig {
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export interface ModelRequest {
  model: string;
  systemInstruction: string;
  contents: ConversationTurn[];
  tools?: GeminiToolDeclaration[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string | null;
  toolCalls: { name: string; args: Record<string, unknown>; thoughtSignature?: string }[];
  thinkingText?: string;
  usageMetadata: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
}

export interface ImageResponse {
  /** Base64-encoded image data */
  imageData: string;
  /** MIME type of the image (e.g. 'image/png') */
  mimeType: string;
}

// ─── Provider detection ──────────────────────────────────────

export function detectProvider(model: string): ModelProvider {
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-') || model.startsWith('o4-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error(`Unknown model provider for "${model}". Expected prefix: gemini-, gpt-, o1-, o3-, o4-, or claude-`);
}

// ─── ModelClient ─────────────────────────────────────────────

export class ModelClient {
  private gemini?: GoogleGenAI;
  private openai?: OpenAI;
  private anthropic?: Anthropic;

  constructor(config: ModelClientConfig | string) {
    // Backwards-compatible: if a plain string is passed, treat as Gemini API key
    if (typeof config === 'string') {
      this.gemini = new GoogleGenAI({ apiKey: config });
      return;
    }

    if (config.geminiApiKey) {
      this.gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    if (config.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    }
    if (config.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal?.aborted) {
      const reason = (request.signal.reason as Error)?.message || 'signal aborted';
      throw new Error(`Aborted: ${reason}`);
    }

    const provider = detectProvider(request.model);
    const MAX_RETRIES = 1;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        switch (provider) {
          case 'gemini':
            return await this.generateGemini(request);
          case 'openai':
            return await this.generateOpenAI(request);
          case 'anthropic':
            return await this.generateAnthropic(request);
        }
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // Don't retry if the supervisor aborted or the request was cancelled
        if (request.signal?.aborted) throw err;
        // Don't retry on auth/validation errors (4xx except 429)
        if (/40[0-3]|404|422/.test(msg)) throw err;
        // Retry on timeouts and transient server errors (5xx, 429)
        if (attempt < MAX_RETRIES) {
          const backoffMs = 2000 * (attempt + 1);
          console.warn(`[ModelClient] Attempt ${attempt + 1} failed (${msg}), retrying in ${backoffMs}ms…`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
    // Unreachable, but TypeScript needs it
    throw new Error('Unexpected: exhausted retries');
  }

  /**
   * Generate an image using Gemini's native image generation.
   * Uses responseModalities: ['IMAGE'] to get a real image back.
   */
  async generateImage(prompt: string, model = 'gemini-3-pro-image-preview'): Promise<ImageResponse> {
    if (!this.gemini) throw new Error('Gemini API key not configured');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.gemini.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }] as any,
      config: {
        responseModalities: ['IMAGE'],
      },
    });

    const r = response as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
      }>;
    };

    const parts = r.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      throw new Error('No image data returned from Gemini image generation');
    }

    return {
      imageData: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? 'image/png',
    };
  }

  // ─── Gemini ──────────────────────────────────────────────

  private async generateGemini(request: ModelRequest): Promise<ModelResponse> {
    if (!this.gemini) throw new Error('Gemini API key not configured');

    const geminiContents = this.mapConversationGemini(request.contents);
    const geminiTools = request.tools?.length
      ? [{ functionDeclarations: request.tools }]
      : undefined;

    // Build thinking config based on model family
    const thinkingEnabled = request.thinkingEnabled ?? true;
    let thinkingConfig: Record<string, unknown> | undefined;
    if (request.model.startsWith('gemini-3')) {
      // Gemini 3.x: use thinkingLevel
      thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: thinkingEnabled ? 'high' : 'minimal',
      };
    } else if (request.model.startsWith('gemini-2.5')) {
      // Gemini 2.5: use thinkingBudget
      thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: thinkingEnabled ? -1 : 0,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiPromise = this.gemini.models.generateContent({
      model: request.model,
      contents: geminiContents as any,
      config: {
        systemInstruction: request.systemInstruction,
        temperature: request.temperature ?? 0.7,
        topP: request.topP,
        topK: request.topK,
        ...(geminiTools ? { tools: geminiTools as any } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    const response = await this.raceAbort(apiPromise, request.signal);
    return this.mapGeminiResponse(response);
  }

  private mapConversationGemini(turns: ConversationTurn[]): unknown[] {
    const contents: unknown[] = [];
    let i = 0;

    while (i < turns.length) {
      const turn = turns[i];

      switch (turn.role) {
        case 'user':
          contents.push({ role: 'user', parts: [{ text: turn.content }] });
          i++;
          break;
        case 'assistant':
          contents.push({ role: 'model', parts: [{ text: turn.content }] });
          i++;
          break;
        case 'tool_call': {
          // Batch consecutive tool_call turns into a single model message
          // including thinking parts and thought signatures (required by Gemini 3+)
          const modelParts: Record<string, unknown>[] = [];

          if (turn.thinkingBeforeTools) {
            modelParts.push({ text: turn.thinkingBeforeTools, thought: true });
          }

          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            const fcPart: Record<string, unknown> = {
              functionCall: {
                name: tc.toolName,
                args: tc.toolParams ?? {},
              },
            };
            if (tc.thoughtSignature) {
              fcPart.thoughtSignature = tc.thoughtSignature;
            }
            modelParts.push(fcPart);
            i++;
          }

          contents.push({ role: 'model', parts: modelParts });
          break;
        }
        case 'tool_result': {
          // Batch consecutive tool_result turns into a single user message
          const frParts: unknown[] = [];

          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            let resultValue: unknown;
            try {
              resultValue = JSON.parse(tr.content);
            } catch {
              resultValue = tr.content;
            }
            frParts.push({
              functionResponse: {
                name: tr.toolName,
                response: { result: resultValue },
              },
            });
            i++;
          }

          contents.push({ role: 'user', parts: frParts });
          break;
        }
        default:
          i++;
      }
    }

    return contents;
  }

  private mapGeminiResponse(response: unknown): ModelResponse {
    const r = response as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };

    const candidate = r.candidates?.[0];
    if (!candidate) throw new Error('No response candidate from Gemini');

    const parts = candidate.content?.parts ?? [];

    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('') || null;

    const thinkingText = parts
      .filter((p) => p.text && p.thought)
      .map((p) => p.text)
      .join('') || undefined;

    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({
        name: p.functionCall!.name,
        args: p.functionCall!.args || {},
        thoughtSignature: p.thoughtSignature,
      }));

    const usage = r.usageMetadata;

    return {
      text,
      toolCalls,
      thinkingText,
      usageMetadata: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      finishReason: candidate.finishReason ?? 'UNKNOWN',
    };
  }

  // ─── OpenAI ──────────────────────────────────────────────

  private async generateOpenAI(request: ModelRequest): Promise<ModelResponse> {
    if (!this.openai) throw new Error('OpenAI API key not configured');

    const messages = this.mapConversationOpenAI(request);

    const tools = request.tools?.length
      ? request.tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    // o-series models (o1, o3, o4) don't accept temperature, top_p, or max_tokens
    const isOSeries = /^o[134]-/.test(request.model);
    // GPT-5 family: gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano, etc.
    const isGpt5Family = request.model.startsWith('gpt-5');
    // GPT-5.2/5.1 support 'none' reasoning (allows temperature); older gpt-5 does not
    const supportsNoneReasoning = /^gpt-5\.[12]/.test(request.model);

    // Determine reasoning effort for GPT-5 family
    // GPT-5.2/5.1 default to 'none'; older GPT-5 defaults to 'medium'
    // SDK type may lag behind the API — cast to string for forward compat
    let reasoningEffort: string | undefined;
    if (isGpt5Family) {
      const thinkingEnabled = request.thinkingEnabled ?? false;
      if (supportsNoneReasoning) {
        // gpt-5.1/5.2: default 'none', use 'medium' only when thinking explicitly requested
        reasoningEffort = thinkingEnabled ? 'medium' : 'none';
      } else {
        // gpt-5, gpt-5-mini, gpt-5-nano: always reason, default 'medium'
        reasoningEffort = thinkingEnabled ? 'high' : 'medium';
      }
    }

    // GPT-5 family and o-series require max_completion_tokens instead of max_tokens
    // temperature and top_p are forbidden for o-series and GPT-5 family (unless reasoning='none')
    const forbidTempTopP = isOSeries || (isGpt5Family && reasoningEffort !== 'none');
    const useMaxCompletionTokens = isOSeries || isGpt5Family;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createParams: any = {
      model: request.model,
      messages,
      tools,
      ...(useMaxCompletionTokens
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens }),
      ...(forbidTempTopP
        ? {}
        : {
            temperature: request.temperature ?? 0.7,
            top_p: request.topP,
          }),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };

    const apiPromise = this.openai.chat.completions.create(createParams) as Promise<OpenAI.Chat.Completions.ChatCompletion>;

    const response = await this.raceAbort(apiPromise, request.signal);
    return this.mapOpenAIResponse(response);
  }

  private mapConversationOpenAI(
    request: ModelRequest,
  ): Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: request.systemInstruction },
    ];

    const turns = request.contents;
    let i = 0;
    let lastToolCallIds: string[] = [];

    while (i < turns.length) {
      const turn = turns[i];
      switch (turn.role) {
        case 'user':
          messages.push({ role: 'user', content: turn.content });
          i++;
          break;
        case 'assistant':
          messages.push({ role: 'assistant', content: turn.content });
          i++;
          break;
        case 'tool_call': {
          // Batch consecutive tool_call turns into a single assistant message
          const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
          lastToolCallIds = [];
          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            const id = `call_${tc.toolName}_${tc.timestamp}`;
            lastToolCallIds.push(id);
            toolCalls.push({
              id,
              type: 'function',
              function: {
                name: tc.toolName!,
                arguments: JSON.stringify(tc.toolParams ?? {}),
              },
            });
            i++;
          }
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
          });
          break;
        }
        case 'tool_result': {
          // Each tool_result is a separate 'tool' message, but must reference
          // the correct tool_call_id from the preceding tool_call batch
          let resultIndex = 0;
          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            const toolCallId = resultIndex < lastToolCallIds.length
              ? lastToolCallIds[resultIndex]
              : `call_${tr.toolName}_${tr.timestamp}`;
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: tr.content,
            });
            resultIndex++;
            i++;
          }
          break;
        }
        default:
          i++;
      }
    }

    return messages;
  }

  private mapOpenAIResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): ModelResponse {
    const choice = response.choices[0];
    if (!choice) throw new Error('No response choice from OpenAI');

    const toolCalls = (choice.message.tool_calls ?? []).map(tc => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
    }));

    return {
      text: choice.message.content,
      toolCalls,
      usageMetadata: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: choice.finish_reason ?? 'unknown',
    };
  }

  // ─── Anthropic ───────────────────────────────────────────

  private async generateAnthropic(request: ModelRequest): Promise<ModelResponse> {
    if (!this.anthropic) throw new Error('Anthropic API key not configured');

    const messages = this.mapConversationAnthropic(request.contents);

    const tools = request.tools?.length
      ? request.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object' as const,
            properties: t.parameters.properties,
            required: t.parameters.required,
          },
        }))
      : undefined;

    // Extended thinking is only supported on claude-3-5-sonnet-*, claude-3-7-*, claude-4-*, and later
    const thinkingEnabled = request.thinkingEnabled ?? true;
    const supportsThinking = /claude-(3-[5-9]|[4-9]|sonnet-4|opus-4)/.test(request.model);
    const useThinking = thinkingEnabled && supportsThinking;
    const thinkingParam = useThinking
      ? { thinking: { type: 'enabled' as const, budget_tokens: 8192 } }
      : {};

    const apiPromise = this.anthropic.messages.create({
      model: request.model,
      system: request.systemInstruction,
      messages,
      tools,
      max_tokens: request.maxTokens ?? 4096,
      temperature: useThinking ? 1 : (request.temperature ?? 0.7),
      top_p: request.topP,
      ...thinkingParam,
    } as Parameters<typeof this.anthropic.messages.create>[0]);

    const response = await this.raceAbort(apiPromise, request.signal) as Anthropic.Message;
    return this.mapAnthropicResponse(response);
  }

  private mapConversationAnthropic(
    turns: ConversationTurn[],
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    let i = 0;
    let lastToolUseIds: string[] = [];

    while (i < turns.length) {
      const turn = turns[i];
      switch (turn.role) {
        case 'user':
          messages.push({ role: 'user', content: turn.content });
          i++;
          break;
        case 'assistant':
          messages.push({ role: 'assistant', content: turn.content });
          i++;
          break;
        case 'tool_call': {
          // Batch consecutive tool_call turns into a single assistant message
          const content: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
          lastToolUseIds = [];
          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            const id = `call_${tc.toolName}_${tc.timestamp}`;
            lastToolUseIds.push(id);
            content.push({
              type: 'tool_use',
              id,
              name: tc.toolName!,
              input: (tc.toolParams ?? {}) as Record<string, unknown>,
            });
            i++;
          }
          messages.push({ role: 'assistant', content });
          break;
        }
        case 'tool_result': {
          // Batch consecutive tool_result turns into a single user message
          const content: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
          let resultIndex = 0;
          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            const toolUseId = resultIndex < lastToolUseIds.length
              ? lastToolUseIds[resultIndex]
              : `call_${tr.toolName}_${tr.timestamp}`;
            content.push({
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: tr.content,
            });
            resultIndex++;
            i++;
          }
          messages.push({ role: 'user', content });
          break;
        }
        default:
          i++;
      }
    }

    return messages;
  }

  private mapAnthropicResponse(response: Anthropic.Message): ModelResponse {
    let text: string | null = null;
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    let thinkingText: string | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        text = (text ?? '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          args: (block.input as Record<string, unknown>) ?? {},
        });
      } else if (block.type === 'thinking') {
        thinkingText = (thinkingText ?? '') + (block as { thinking: string }).thinking;
      }
    }

    return {
      text,
      toolCalls,
      thinkingText,
      usageMetadata: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason ?? 'unknown',
    };
  }

  // ─── Shared helpers ──────────────────────────────────────

  private async raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    // Always enforce a per-call timeout (180s) to prevent indefinite API hangs.
    // This is independent of the supervisor's between-turn timeout check.
    // Large system prompts (knowledge base + memories + personality + 24 tool
    // declarations) on preview models can take 60-120s, so 180s gives headroom.
    const PER_CALL_TIMEOUT_MS = 180_000;
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
