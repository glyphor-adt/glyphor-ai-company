/**
 * Model Client — Gemini API wrapper with AbortSignal support
 *
 * Ported from Fuse V7 runtime/modelClient.ts.
 * Thin wrapper around @google/genai with native AbortSignal race.
 */

import { GoogleGenAI } from '@google/genai';
import type { ConversationTurn, GeminiToolDeclaration } from './types.js';

export interface ModelRequest {
  model: string;
  systemInstruction: string;
  contents: ConversationTurn[];
  tools?: GeminiToolDeclaration[];
  temperature?: number;
  topP?: number;
  topK?: number;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string | null;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  thinkingText?: string;
  usageMetadata: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
}

export class ModelClient {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal?.aborted) {
      const reason = (request.signal.reason as Error)?.message || 'signal aborted';
      throw new Error(`Aborted: ${reason}`);
    }

    const geminiContents = this.mapConversation(request.contents);
    const geminiTools = request.tools?.length
      ? [{ functionDeclarations: request.tools }]
      : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiPromise = this.client.models.generateContent({
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

    let response: Awaited<typeof apiPromise>;

    if (request.signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => {
          const reason = (request.signal!.reason as Error)?.message || 'signal aborted';
          reject(new Error(`Aborted: ${reason}`));
        };
        if (request.signal!.aborted) {
          onAbort();
        } else {
          request.signal!.addEventListener('abort', onAbort, { once: true });
        }
      });
      response = await Promise.race([apiPromise, abortPromise]);
    } else {
      response = await apiPromise;
    }

    return this.mapResponse(response);
  }

  private mapConversation(turns: ConversationTurn[]): unknown[] {
    const contents: unknown[] = [];

    for (const turn of turns) {
      switch (turn.role) {
        case 'user':
          contents.push({ role: 'user', parts: [{ text: turn.content }] });
          break;
        case 'assistant':
          contents.push({ role: 'model', parts: [{ text: turn.content }] });
          break;
        case 'tool_call':
          contents.push({
            role: 'model',
            parts: [{
              functionCall: {
                name: turn.toolName,
                args: turn.toolParams ?? {},
              },
            }],
          });
          break;
        case 'tool_result': {
          let resultValue: unknown;
          try {
            resultValue = JSON.parse(turn.content);
          } catch {
            resultValue = turn.content;
          }
          contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: turn.toolName,
                response: { result: resultValue },
              },
            }],
          });
          break;
        }
      }
    }

    return contents;
  }

  private mapResponse(response: unknown): ModelResponse {
    const r = response as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };

    const candidate = r.candidates?.[0];
    if (!candidate) {
      throw new Error('No response candidate from model');
    }

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
}
