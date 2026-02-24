/**
 * OpenAI Provider Adapter — Maps OpenAI API to unified types.
 *
 * Supports GPT-4o, o-series (o1/o3/o4), and GPT-5 family with
 * reasoning_effort control.
 */

import OpenAI from 'openai';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './types.js';

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const messages = this.mapConversation(request);

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
    const isOSeries = /^o[134](-|$)/.test(request.model);
    // GPT-5 family: gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano, etc.
    const isGpt5Family = request.model.startsWith('gpt-5');
    // GPT-5.2/5.1 support 'none' reasoning (allows temperature)
    const supportsNoneReasoning = /^gpt-5\.[12]/.test(request.model);

    let reasoningEffort: string | undefined;
    if (isGpt5Family) {
      const thinkingEnabled = request.thinkingEnabled ?? false;
      if (supportsNoneReasoning) {
        reasoningEffort = thinkingEnabled ? 'medium' : 'none';
      } else {
        reasoningEffort = thinkingEnabled ? 'high' : 'medium';
      }
    }

    const forbidTempTopP = isOSeries || (isGpt5Family && reasoningEffort !== 'none');
    const useMaxCompletionTokens = isOSeries || isGpt5Family;
    const resolvedMaxTokens = request.maxTokens ?? (useMaxCompletionTokens ? 16384 : undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createParams: any = {
      model: request.model,
      messages,
      ...(tools ? { tools } : {}),
      ...(resolvedMaxTokens !== undefined
        ? (useMaxCompletionTokens
            ? { max_completion_tokens: resolvedMaxTokens }
            : { max_tokens: resolvedMaxTokens })
        : {}),
      ...(forbidTempTopP
        ? {}
        : {
            temperature: request.temperature ?? 0.7,
            ...(request.topP !== undefined ? { top_p: request.topP } : {}),
          }),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };

    const response = await this.client.chat.completions.create(createParams) as OpenAI.Chat.Completions.ChatCompletion;
    return this.mapResponse(response);
  }

  /**
   * Generate an image using OpenAI gpt-image-1 (text-rich infographics).
   * Uses direct fetch instead of the SDK to avoid connection issues in Cloud Run.
   */
  async generateImage(prompt: string, model = 'gpt-image-1'): Promise<ImageResponse> {
    const apiKey = this.client.apiKey;
    if (!apiKey) throw new Error('OpenAI API key is empty');

    const body = JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'high',
    });

    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      throw new Error(`OpenAI image generation failed (${resp.status}): ${errText}`);
    }

    const json = await resp.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      const url = json.data?.[0]?.url;
      if (url) {
        const imgResp = await fetch(url);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        return { imageData: buf.toString('base64'), mimeType: 'image/png' };
      }
      throw new Error('No image data returned from OpenAI image generation');
    }

    return {
      imageData: b64,
      mimeType: 'image/png',
    };
  }

  private mapConversation(
    request: UnifiedModelRequest,
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

  private mapResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): UnifiedModelResponse {
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
}
