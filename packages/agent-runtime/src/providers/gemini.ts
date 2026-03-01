/**
 * Gemini Provider Adapter — Maps Google Gemini API to unified types.
 *
 * Supports Gemini 2.5 (thinkingBudget) and Gemini 3.x (thinkingLevel)
 * with thought signatures for function call replay.
 */

import { GoogleGenAI } from '@google/genai';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './types.js';

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const geminiContents = this.mapConversation(request.contents);
    const geminiTools = request.tools?.length
      ? [{ functionDeclarations: request.tools }]
      : undefined;

    // Build thinking config based on model family
    const thinkingEnabled = request.thinkingEnabled ?? true;
    let thinkingConfig: Record<string, unknown> | undefined;
    if (request.model.startsWith('gemini-3')) {
      // Gemini 3.x: always set thinkingConfig — omitting it defaults to MINIMAL which is unsupported
      thinkingConfig = {
        includeThoughts: thinkingEnabled,
        thinkingLevel: thinkingEnabled ? 'high' : 'low',
      };
    } else if (request.model.startsWith('gemini-2.5')) {
      thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: thinkingEnabled ? -1 : 0,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.client.models.generateContent({
      model: request.model,
      contents: geminiContents as any,
      config: {
        systemInstruction: request.systemInstruction,
        temperature: request.temperature ?? 0.7,
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.topK !== undefined ? { topK: request.topK } : {}),
        ...(geminiTools ? { tools: geminiTools as any } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    return this.mapResponse(response);
  }

  /**
   * Generate an image using Google Imagen 4 Ultra.
   */
  async generateImage(prompt: string, model = 'imagen-4.0-ultra-generate-001'): Promise<ImageResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.client.models.generateImages({
      model,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '16:9',
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const image = (response as any).generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      throw new Error('No image data returned from Imagen image generation');
    }

    return {
      imageData: image.image.imageBytes,
      mimeType: 'image/png',
    };
  }

  private mapConversation(turns: ConversationTurn[]): unknown[] {
    const contents: unknown[] = [];
    let i = 0;

    while (i < turns.length) {
      const turn = turns[i];

      switch (turn.role) {
        case 'user': {
          const userParts: Record<string, unknown>[] = [];
          if (turn.content) userParts.push({ text: turn.content });
          if (turn.attachments?.length) {
            for (const att of turn.attachments) {
              // Gemini accepts images and PDFs as inline data
              if (att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf') {
                userParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
              } else {
                // Text-based files: decode and inject as text
                const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
                const content = decoded.length > 50000 ? decoded.slice(0, 50000) + '\n...(truncated)' : decoded;
                userParts.push({ text: `[File: ${att.name}]\n\`\`\`\n${content}\n\`\`\`` });
              }
            }
          }
          if (userParts.length === 0) userParts.push({ text: '' });
          contents.push({ role: 'user', parts: userParts });
          i++;
          break;
        }
        case 'assistant':
          contents.push({ role: 'model', parts: [{ text: turn.content }] });
          i++;
          break;
        case 'tool_call': {
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

  /** Normalize Gemini finish reasons to a consistent set: stop | tool_use | length */
  private normalizeFinishReason(reason?: string): string {
    if (!reason) return 'stop';
    switch (reason.toUpperCase()) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'safety';
      default: return reason.toLowerCase();
    }
  }

  private mapResponse(response: unknown): UnifiedModelResponse {
    const r = response as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
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
    const thinkingTokens = usage?.thoughtsTokenCount ?? 0;
    // candidatesTokenCount includes thinking tokens — subtract to get pure output
    const rawOutputTokens = usage?.candidatesTokenCount ?? 0;
    const pureOutputTokens = Math.max(0, rawOutputTokens - thinkingTokens);

    return {
      text,
      toolCalls,
      thinkingText,
      usageMetadata: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: pureOutputTokens,
        totalTokens: usage?.totalTokenCount ?? 0,
        thinkingTokens: thinkingTokens || undefined,
        cachedInputTokens: usage?.cachedContentTokenCount || undefined,
      },
      finishReason: this.normalizeFinishReason(candidate.finishReason),
    };
  }
}
