/**
 * Gemini Provider Adapter — Maps Google Gemini API to unified types.
 *
 * Supports Gemini 2.5 (thinkingBudget) and Gemini 3.x (thinkingLevel)
 * with thought signatures for function call replay.
 */

import { GoogleGenAI } from '@google/genai';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './types.js';

export interface GeminiAdapterConfig {
  /** Google AI Studio API key (direct access). */
  apiKey?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini' as const;
  private client: GoogleGenAI;

  constructor(config: string | GeminiAdapterConfig) {
    if (typeof config === 'string') {
      // Backward-compatible: plain string = API key
      this.client = new GoogleGenAI({ apiKey: config });
      return;
    }
    if (config.apiKey) {
      this.client = new GoogleGenAI({ apiKey: config.apiKey });
    } else {
      throw new Error('GeminiAdapter requires apiKey');
    }
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const geminiContents = this.mapConversation(request.contents);
    const modelConfig = request.metadata?.modelConfig;
    const structuredOutputSchema = modelConfig?.structuredOutput?.schema
      ? structuredClone(modelConfig.structuredOutput.schema)
      : undefined;
    // Deep-clone tools: the @google/genai SDK mutates functionDeclaration objects
    // in-place (uppercasing type fields via processJsonSchema). Without cloning,
    // the shared tool references get corrupted for cross-provider fallbacks.
    const geminiTools: Array<Record<string, unknown>> = [];
    if (request.tools?.length) {
      const cleaned = structuredClone(request.tools).map((tool) => {
        const { name, description, parameters } = tool;
        return { name, description, parameters };
      });
      geminiTools.push({ functionDeclarations: cleaned });
    }
    const hasFunctionDeclarations = geminiTools.some((tool) => Array.isArray((tool as { functionDeclarations?: unknown }).functionDeclarations));

    // Build thinking config based on model family
    const thinkingEnabled = request.thinkingEnabled ?? true;
    const reasoningLevel = request.reasoningLevel ?? (thinkingEnabled ? 'deep' : 'none');
    let thinkingConfig: Record<string, unknown> | undefined;
    if (request.model.startsWith('gemini-3')) {
      const thinkingLevel = modelConfig?.thinkingLevel
        ?? (modelConfig?.reasoningEffort === 'high' || reasoningLevel === 'deep' ? 'high' : 'low');
      thinkingConfig = {
        includeThoughts: reasoningLevel !== 'none',
        thinkingLevel,
      };
    } else if (request.model.startsWith('gemini-2.5')) {
      if (reasoningLevel === 'none' && modelConfig?.thinkingBudget === undefined) {
        thinkingConfig = {
          includeThoughts: false,
        };
      } else {
        const thinkingBudget = modelConfig?.thinkingBudget ?? (
          modelConfig?.reasoningEffort === 'high' || reasoningLevel === 'deep'
            ? -1
            : reasoningLevel === 'standard'
              ? 2048
              : 1024
        );
        thinkingConfig = {
          includeThoughts: reasoningLevel !== 'none',
          thinkingBudget,
        };
      }
    }

    const googleSearchEnabled = Boolean(modelConfig?.enableGoogleSearch && !hasFunctionDeclarations);
    const codeExecutionEnabled = Boolean(modelConfig?.enableCodeExecution && !hasFunctionDeclarations);

    if (googleSearchEnabled) {
      geminiTools.push({ googleSearch: {} });
    } else if (modelConfig?.enableGoogleSearch && hasFunctionDeclarations) {
      console.warn(`[Gemini] ${request.model}: skipping googleSearch because functionDeclarations are present (mixed tool types are rejected by Gemini API)`);
    }

    if (codeExecutionEnabled) {
      geminiTools.push({ codeExecution: {} });
    } else if (modelConfig?.enableCodeExecution && hasFunctionDeclarations) {
      console.warn(`[Gemini] ${request.model}: skipping codeExecution because functionDeclarations are present (mixed tool types are rejected by Gemini API)`);
    }

    const systemInstruction = [
      request.systemInstruction,
      googleSearchEnabled ? 'Use grounded web search when current external information is required.' : null,
      codeExecutionEnabled ? 'Use code execution for calculations or data transformations when it improves accuracy.' : null,
      modelConfig?.structuredOutput
        ? `Return valid JSON matching this schema exactly: ${JSON.stringify(modelConfig.structuredOutput.schema)}`
        : null,
    ].filter(Boolean).join('\n\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestPayload = {
      model: request.model,
      contents: geminiContents as any,
      config: {
        systemInstruction,
        temperature: request.temperature ?? 0.7,
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.topK !== undefined ? { topK: request.topK } : {}),
        ...(geminiTools.length > 0 ? { tools: geminiTools as any } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
        ...(modelConfig?.structuredOutput ? {
          responseMimeType: 'application/json',
          responseSchema: structuredOutputSchema as any,
        } : {}),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: unknown;
    try {
      response = await this.client.models.generateContent(requestPayload as any);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // Gemini 3+ requires thought_signature on all function call parts.
      // If signatures were lost (SDK bug, response parsing issue), retry
      // with thinking disabled so signatures are not required.
      if (/thought_signature/i.test(msg) && thinkingConfig) {
        console.warn(`[Gemini] thought_signature error — retrying ${request.model} with thinking disabled`);
        const retryContents = this.stripToolCallHistory(geminiContents as Record<string, unknown>[]);
        const retryPayload = {
          ...requestPayload,
          contents: retryContents,
          config: {
            ...(requestPayload.config as Record<string, unknown>),
            thinkingConfig: { includeThoughts: false },
          },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response = await this.client.models.generateContent(retryPayload as any);
        return this.mapResponse(response);
      }
      throw err;
    }

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

  /**
   * Generate a video using Google Veo 3.1.
   * Uses the Gemini API's video generation endpoint.
   */
  async generateVideo(
    prompt: string,
    options?: { aspectRatio?: string; durationSeconds?: number; negativePrompt?: string },
  ): Promise<{ videoData: string | null }> {
    try {
      // Veo 3.1 via Gemini API (uses generateVideos when available)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genClient = this.client as any;
      if (typeof genClient.models?.generateVideos !== 'function') {
        // Fallback: use the REST API directly for video generation
        const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('No Google AI API key for video generation');

        const model = 'veo-3.1-generate';
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{
                prompt,
                ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
              }],
              parameters: {
                aspectRatio: options?.aspectRatio ?? '16:9',
                durationSeconds: options?.durationSeconds ?? 6,
                sampleCount: 1,
              },
            }),
          },
        );

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Veo API error ${response.status}: ${errBody.slice(0, 300)}`);
        }

        // Long-running operation — poll until done
        const operation = await response.json() as { name?: string; done?: boolean; response?: { predictions?: Array<{ videoBytes?: string }> } };

        if (operation.done && operation.response?.predictions?.[0]?.videoBytes) {
          return { videoData: operation.response.predictions[0].videoBytes };
        }

        // Poll the operation
        if (operation.name) {
          const maxPollAttempts = 30;
          const pollIntervalMs = 5_000;
          for (let i = 0; i < maxPollAttempts; i++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            const pollResp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${apiKey}`,
            );
            if (!pollResp.ok) continue;
            const pollResult = await pollResp.json() as { done?: boolean; response?: { predictions?: Array<{ videoBytes?: string }> } };
            if (pollResult.done) {
              const videoBytes = pollResult.response?.predictions?.[0]?.videoBytes;
              return { videoData: videoBytes ?? null };
            }
          }
        }

        return { videoData: null };
      }

      // Direct SDK path
      const response = await genClient.models.generateVideos({
        model: 'veo-3.1-generate',
        prompt,
        config: {
          numberOfVideos: 1,
          aspectRatio: options?.aspectRatio ?? '16:9',
          durationSeconds: options?.durationSeconds ?? 6,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const video = (response as any).generatedVideos?.[0];
      return { videoData: video?.video?.videoBytes ?? null };
    } catch (err) {
      console.warn(`[Gemini] Video generation failed: ${(err as Error).message}`);
      return { videoData: null };
    }
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

  /**
   * Strip function call and function response turns from Gemini contents.
   * Used as a fallback when thought_signature errors prevent replaying
   * tool call history. Collapses tool interactions into text summaries
   * so the model has context without needing signatures.
   */
  private stripToolCallHistory(contents: Record<string, unknown>[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (const content of contents) {
      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (!parts) { result.push(content); continue; }

      const hasFunctionCall = parts.some((p) => p.functionCall);
      const hasFunctionResponse = parts.some((p) => p.functionResponse);

      if (hasFunctionCall) {
        // Convert function calls into a text summary
        const names = parts
          .filter((p) => p.functionCall)
          .map((p) => (p.functionCall as { name: string }).name);
        result.push({
          role: 'model',
          parts: [{ text: `[Previously called tools: ${names.join(', ')}]` }],
        });
      } else if (hasFunctionResponse) {
        // Convert function responses into a text summary
        const summaries = parts
          .filter((p) => p.functionResponse)
          .map((p) => {
            const fr = p.functionResponse as { name: string; response: unknown };
            const resultStr = JSON.stringify(fr.response);
            const truncated = resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr;
            return `${fr.name}: ${truncated}`;
          });
        result.push({
          role: 'user',
          parts: [{ text: `[Tool results]\n${summaries.join('\n')}` }],
        });
      } else {
        result.push(content);
      }
    }

    return result;
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
      .map((p) => {
        if (p.functionCall && !p.thoughtSignature) {
          console.warn(`[Gemini] Function call '${p.functionCall.name}' returned WITHOUT thoughtSignature`);
        }
        return {
          name: p.functionCall!.name,
          args: p.functionCall!.args || {},
          thoughtSignature: p.thoughtSignature,
        };
      });

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
