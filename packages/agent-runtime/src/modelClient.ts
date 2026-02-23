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
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string | null;
  toolCalls: { name: string; args: Record<string, unknown>; thoughtSignature?: string }[];
  thinkingText?: string;
  usageMetadata: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
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

    switch (provider) {
      case 'gemini':
        return this.generateGemini(request);
      case 'openai':
        return this.generateOpenAI(request);
      case 'anthropic':
        return this.generateAnthropic(request);
    }
  }

  // ─── Gemini ──────────────────────────────────────────────

  private async generateGemini(request: ModelRequest): Promise<ModelResponse> {
    if (!this.gemini) throw new Error('Gemini API key not configured');

    const geminiContents = this.mapConversationGemini(request.contents);
    const geminiTools = request.tools?.length
      ? [{ functionDeclarations: request.tools }]
      : undefined;

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

    const apiPromise = this.openai.chat.completions.create({
      model: request.model,
      messages,
      tools,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP,
      max_tokens: request.maxTokens,
    });

    const response = await this.raceAbort(apiPromise, request.signal);
    return this.mapOpenAIResponse(response);
  }

  private mapConversationOpenAI(
    request: ModelRequest,
  ): Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: request.systemInstruction },
    ];

    for (const turn of request.contents) {
      switch (turn.role) {
        case 'user':
          messages.push({ role: 'user', content: turn.content });
          break;
        case 'assistant':
          messages.push({ role: 'assistant', content: turn.content });
          break;
        case 'tool_call':
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: `call_${turn.toolName}_${turn.timestamp}`,
              type: 'function',
              function: {
                name: turn.toolName!,
                arguments: JSON.stringify(turn.toolParams ?? {}),
              },
            }],
          });
          break;
        case 'tool_result':
          messages.push({
            role: 'tool',
            tool_call_id: `call_${turn.toolName}_${turn.timestamp}`,
            content: turn.content,
          });
          break;
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

    const apiPromise = this.anthropic.messages.create({
      model: request.model,
      system: request.systemInstruction,
      messages,
      tools,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP,
    });

    const response = await this.raceAbort(apiPromise, request.signal);
    return this.mapAnthropicResponse(response);
  }

  private mapConversationAnthropic(
    turns: ConversationTurn[],
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    for (const turn of turns) {
      switch (turn.role) {
        case 'user':
          messages.push({ role: 'user', content: turn.content });
          break;
        case 'assistant':
          messages.push({ role: 'assistant', content: turn.content });
          break;
        case 'tool_call':
          messages.push({
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: `call_${turn.toolName}_${turn.timestamp}`,
              name: turn.toolName!,
              input: turn.toolParams ?? {},
            }],
          });
          break;
        case 'tool_result':
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: `call_${turn.toolName}_${turn.timestamp}`,
              content: turn.content,
            }],
          });
          break;
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
    // Always enforce a per-call timeout (120s) to prevent indefinite API hangs.
    // This is independent of the supervisor's between-turn timeout check.
    // Large system prompts (knowledge base + memories + personality) can take
    // 30-90s on first call, so 120s gives enough headroom.
    const PER_CALL_TIMEOUT_MS = 120_000;
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
