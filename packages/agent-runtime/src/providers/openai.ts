/**
 * OpenAI Provider Adapter — Maps OpenAI API to unified types.
 *
 * Supports GPT-4o, o-series (o1/o3/o4), and GPT-5 family with
 * reasoning_effort control.
 *
 * Supports both direct OpenAI and Azure OpenAI:
 *   - Direct: pass { apiKey }
 *   - Azure:  pass { azureEndpoint, azureApiKey } — uses AzureOpenAI SDK
 *     which routes through your Azure subscription (pay-as-you-go billing).
 */

import OpenAI, { AzureOpenAI } from 'openai';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './types.js';

/** Configuration for OpenAI adapter — either direct or Azure-backed. */
export interface OpenAIAdapterConfig {
  /** Direct OpenAI API key (api.openai.com). Used as fallback for features not on Azure. */
  apiKey?: string;
  /** Azure OpenAI endpoint, e.g. https://my-resource.openai.azure.com */
  azureEndpoint?: string;
  /** Azure OpenAI API key */
  azureApiKey?: string;
  /** Azure OpenAI API version (default: 2025-04-01-preview) */
  azureApiVersion?: string;
}

/**
 * Recursively lowercase all `type` fields in a JSON Schema object.
 * Guards against the @google/genai SDK mutating types to uppercase
 * (e.g. STRING → string) which OpenAI rejects.
 */
function normalizeSchemaTypes(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      result[key] = value.toLowerCase();
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = normalizeSchemaTypes(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizeSchemaTypes(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

const AZURE_API_VERSION = '2025-04-01-preview';

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  private client: OpenAI;
  /** True when routing through Azure OpenAI (billing on Azure subscription). */
  readonly isAzure: boolean;
  /** Azure endpoint URL (only set when isAzure=true). */
  private azureEndpoint?: string;
  /** Azure API version (only set when isAzure=true). */
  private azureApiVersion?: string;
  /** Direct OpenAI API key — kept for fallback on features not available on Azure. */
  private directApiKey?: string;

  constructor(config: OpenAIAdapterConfig | string) {
    // Backwards-compatible: plain string = direct OpenAI API key
    if (typeof config === 'string') {
      config = { apiKey: config };
    }

    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      // Force fresh TCP connections in Cloud Run (no connection pool reuse)
      const resp = await globalThis.fetch(url, {
        ...init,
        keepalive: false,
      });
      return resp;
    };

    if (config.azureEndpoint && config.azureApiKey) {
      // ── Azure OpenAI ──
      this.isAzure = true;
      this.azureEndpoint = config.azureEndpoint;
      this.azureApiVersion = config.azureApiVersion ?? AZURE_API_VERSION;
      this.directApiKey = config.apiKey; // keep for fallback
      this.client = new AzureOpenAI({
        endpoint: config.azureEndpoint,
        apiKey: config.azureApiKey,
        apiVersion: this.azureApiVersion,
        maxRetries: 0,
        timeout: 120_000,
        fetch: customFetch,
      });
      console.log(`[OpenAI] Using Azure OpenAI at ${config.azureEndpoint} (api-version=${this.azureApiVersion})`);
    } else if (config.apiKey) {
      // ── Direct OpenAI ──
      this.isAzure = false;
      this.directApiKey = config.apiKey;
      this.client = new OpenAI({
        apiKey: config.apiKey,
        maxRetries: 0,
        timeout: 120_000,
        fetch: customFetch,
      });
    } else {
      throw new Error('OpenAI adapter requires either apiKey or azureEndpoint + azureApiKey');
    }
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const messages = this.mapConversation(request);

    const MAX_OPENAI_TOOLS = 128;
    const allTools = request.tools?.length
      ? request.tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            // Normalize types to lowercase — the Gemini SDK may have mutated
            // them to uppercase (STRING, OBJECT) which OpenAI rejects.
            parameters: normalizeSchemaTypes(t.parameters),
          },
        }))
      : undefined;

    if (allTools && allTools.length > MAX_OPENAI_TOOLS) {
      console.warn(
        `[OpenAI] ${request.model}: ${allTools.length} tools exceeds ${MAX_OPENAI_TOOLS} limit — truncating to ${MAX_OPENAI_TOOLS}`,
      );
    }
    const tools = allTools?.slice(0, MAX_OPENAI_TOOLS);

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
   * Routes through Azure OpenAI when configured; falls back to direct OpenAI.
   */
  async generateImage(prompt: string, model = 'gpt-image-1.5-2025-12-16'): Promise<ImageResponse> {
    const body = JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'high',
    });

    let url: string;
    let headers: Record<string, string>;

    if (this.isAzure && this.azureEndpoint) {
      // Azure OpenAI image generation endpoint
      // Deployment name = model name (standard convention)
      url = `${this.azureEndpoint}/openai/deployments/${encodeURIComponent(model)}/images/generations?api-version=${this.azureApiVersion}`;
      headers = {
        'Content-Type': 'application/json',
        'api-key': this.client.apiKey,
      };
    } else {
      const apiKey = this.directApiKey ?? this.client.apiKey;
      if (!apiKey) throw new Error('OpenAI API key is empty');
      url = 'https://api.openai.com/v1/images/generations';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
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
    // Global counter across all tool_call batches ensures unique IDs even when
    // the same long-named tool is called multiple times.  Placed at the front
    // of the ID so .slice(0, 40) never amputates the differentiator.
    let toolCallCounter = 0;

    while (i < turns.length) {
      const turn = turns[i];
      switch (turn.role) {
        case 'user': {
          if (turn.attachments?.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parts: any[] = [];
            if (turn.content) parts.push({ type: 'text', text: turn.content });
            for (const att of turn.attachments) {
              if (att.mimeType.startsWith('image/')) {
                parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } });
              } else if (att.mimeType === 'application/pdf') {
                // OpenAI supports PDF via file content part
                parts.push({ type: 'file', file: { filename: att.name, file_data: `data:${att.mimeType};base64,${att.data}` } });
              } else {
                // Text-based files: decode and inject as text
                const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
                const content = decoded.length > 50000 ? decoded.slice(0, 50000) + '\n...(truncated)' : decoded;
                parts.push({ type: 'text', text: `[File: ${att.name}]\n\`\`\`\n${content}\n\`\`\`` });
              }
            }
            messages.push({ role: 'user', content: parts } as any);
          } else {
            messages.push({ role: 'user', content: turn.content });
          }
          i++;
          break;
        }
        case 'assistant':
          messages.push({ role: 'assistant', content: turn.content });
          i++;
          break;
        case 'tool_call': {
          const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
          lastToolCallIds = [];
          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            // Counter goes first so truncation never removes the uniqueness
            // differentiator.  Tool name is trimmed to leave room for counter.
            const id = `call_${toolCallCounter}_${(tc.toolName ?? '').slice(0, 20)}`.slice(0, 40);
            toolCallCounter++;
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
              : `call_fallback_${resultIndex}_${(tr.toolName ?? '').slice(0, 15)}`.slice(0, 40);
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

    // Merge consecutive user messages to avoid issues with models that
    // expect alternating user/assistant turns.
    const merged: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const msg of messages) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === 'user' && msg.role === 'user') {
        // Convert both to content-part arrays and concatenate
        const prevParts = Array.isArray(prev.content)
          ? prev.content
          : [{ type: 'text' as const, text: prev.content as string }];
        const curParts = Array.isArray(msg.content)
          ? (msg.content as Array<{ type: string; text?: string }>)
          : [{ type: 'text' as const, text: msg.content as string }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prev as any).content = [...prevParts, ...curParts];
      } else {
        merged.push(msg);
      }
    }

    return merged;
  }

  /** Normalize OpenAI finish reasons to a consistent set: stop | tool_use | length */
  private normalizeFinishReason(reason?: string | null): string {
    if (!reason) return 'stop';
    switch (reason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'length';
      case 'content_filter': return 'safety';
      default: return reason;
    }
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

    const usageAny = response.usage as unknown as Record<string, Record<string, number> | undefined> | undefined;
    const reasoningTokens = usageAny?.completion_tokens_details?.reasoning_tokens ?? 0;
    const cachedTokens = usageAny?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      text: choice.message.content,
      toolCalls,
      usageMetadata: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        thinkingTokens: reasoningTokens || undefined,
        cachedInputTokens: cachedTokens || undefined,
      },
      finishReason: this.normalizeFinishReason(choice.finish_reason),
    };
  }
}
