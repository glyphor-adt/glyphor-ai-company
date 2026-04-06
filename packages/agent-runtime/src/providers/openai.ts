/**
 * OpenAI Provider Adapter — Maps OpenAI API to unified types.
 *
 * Supports GPT-4o, o-series (o1/o3/o4), and GPT-5 family with
 * reasoning_effort control.
 *
 * Supports direct OpenAI and Azure OpenAI:
 *   - Direct: pass { apiKey }
 *   - Azure:  pass { azureEndpoint, azureApiKey } — uses AzureOpenAI SDK only.
 *     When Azure is configured, the direct API key is ignored (no fallback to api.openai.com).
 *
 * Optional Azure deployment name override (logical id stays o3-deep-research in DB/routes):
 *     AZURE_O3_DEEP_RESEARCH_DEPLOYMENT — e.g. o3-deep-research-2 when that is your deployment name
 */

import OpenAI, { AzureOpenAI } from 'openai';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse, ImageResponse } from './types.js';
import { buildOpenAIContextManagement, extractOpenAICompactionMetadata } from '../compaction.js';
import { buildOpenAITools } from '../openaiToolBuilder.js';
import { shouldUseOpenAIToolSearch } from '../toolSearchConfig.js';

/** Configuration for OpenAI adapter — either direct or Azure-backed. */
export interface OpenAIAdapterConfig {
  /** Direct OpenAI API key (api.openai.com). Ignored when `azureEndpoint` + `azureApiKey` are set. */
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
const DIRECT_OPENAI_TIMEOUT_MS = 300_000;

function getPreferredDirectOpenAIServiceTier(): 'flex' | undefined {
  const configured = process.env.OPENAI_SERVICE_TIER?.trim().toLowerCase();
  if (!configured || configured === 'flex') return 'flex';
  if (['auto', 'default', 'standard', 'off', 'disabled'].includes(configured)) {
    return undefined;
  }
  return 'flex';
}

function shouldRetryWithoutFlex(message: string): boolean {
  return /resource unavailable|insufficient resources/i.test(message)
    || (/service[_\s-]?tier/i.test(message) && /invalid|unsupported|unknown|not available/i.test(message));
}

function supportsMinimalReasoning(model: string): boolean {
  // gpt-5.1 and gpt-5.2 snapshots currently require `none` (not `minimal`) for no-reasoning mode.
  if (/^gpt-5\.(1|2)(-|$)/.test(model)) return false;
  return model.startsWith('gpt-5');
}

function requiresDefaultTemperature(model: string): boolean {
  // Some GPT-5 snapshots reject explicit non-default temperatures and only accept the default value (1).
  return /^gpt-5(?:$|-mini(?:-2025-08-07)?$|-nano$)/.test(model);
}

function shouldForceResponsesApi(model: string): boolean {
  return (
    model.startsWith('gpt-5.4') ||
    /^gpt-5\.[0-9]+-pro$/.test(model) ||
    model === 'gpt-5-pro' ||
    model.includes('-codex')
  );
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  private client: OpenAI;
  private readonly customFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** True when routing through Azure OpenAI (billing on Azure subscription). */
  readonly isAzure: boolean;
  /** Azure endpoint URL (only set when isAzure=true). */
  private azureEndpoint?: string;
  /** Azure API version (only set when isAzure=true). */
  private azureApiVersion?: string;
  /** Direct OpenAI API key — only when not using Azure (`isAzure` false). */
  private directApiKey?: string;
  /** Direct OpenAI client — only when not using Azure. */
  private directClient?: OpenAI;

  constructor(config: OpenAIAdapterConfig | string) {
    // Backwards-compatible: plain string = direct OpenAI API key
    if (typeof config === 'string') {
      config = { apiKey: config };
    }

    this.customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      // Force fresh TCP connections in Cloud Run (no connection pool reuse)
      const resp = await globalThis.fetch(url, {
        ...init,
        keepalive: false,
      });
      return resp;
    };

    if (config.azureEndpoint && config.azureApiKey) {
      // ── Azure OpenAI only — do not retain direct API key; no fallback to api.openai.com
      this.isAzure = true;
      this.azureEndpoint = config.azureEndpoint;
      this.azureApiVersion = config.azureApiVersion ?? AZURE_API_VERSION;
      this.directApiKey = undefined;
      this.client = new AzureOpenAI({
        endpoint: config.azureEndpoint,
        apiKey: config.azureApiKey,
        apiVersion: this.azureApiVersion,
        maxRetries: 0,
        timeout: DIRECT_OPENAI_TIMEOUT_MS,
        fetch: this.customFetch,
      });
      console.log(`[OpenAI] Using Azure OpenAI at ${config.azureEndpoint} (api-version=${this.azureApiVersion})`);
    } else if (config.apiKey) {
      // ── Direct OpenAI ──
      this.isAzure = false;
      this.directApiKey = config.apiKey;
      this.client = this.createDirectClient(config.apiKey);
    } else {
      throw new Error('OpenAI adapter requires either apiKey or azureEndpoint + azureApiKey');
    }
  }

  private createDirectClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: DIRECT_OPENAI_TIMEOUT_MS,
      fetch: this.customFetch,
    });
  }

  /** Azure uses deployment *name*; it may differ from the logical model id (e.g. o3-deep-research-2). */
  private azureDeploymentModel(logicalModel: string): string {
    if (!this.isAzure) return logicalModel;
    if (logicalModel === 'o3-deep-research') {
      const override = process.env.AZURE_O3_DEEP_RESEARCH_DEPLOYMENT?.trim();
      if (override) return override;
    }
    return logicalModel;
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const messages = this.mapConversation(request);
    const modelConfig = request.metadata?.modelConfig;
    const contextManagement = buildOpenAIContextManagement(request.source);
    const hasResponsesApi = typeof (this.client as any).responses?.create === 'function';
    const useHostedToolSearch = shouldUseOpenAIToolSearch(request.model) && hasResponsesApi;

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

    if (!useHostedToolSearch && allTools && allTools.length > MAX_OPENAI_TOOLS) {
      console.warn(
        `[OpenAI] ${request.model}: ${allTools.length} tools exceeds ${MAX_OPENAI_TOOLS} limit — truncating to ${MAX_OPENAI_TOOLS}`,
      );
    }
    const tools = useHostedToolSearch
      ? allTools
      : allTools?.slice(0, MAX_OPENAI_TOOLS);

    // o-series models (o1, o3, o4) don't accept temperature, top_p, or max_tokens
    const isOSeries = /^o[134](-|$)/.test(request.model);
    // GPT-5 family: gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano, etc.
    // Foundry model-router: Chat Completions; may route to GPT-5 / o4-mini — use GPT-5 parameter rules.
    const isGpt5Family = request.model.startsWith('gpt-5')
      || request.model === 'model-router'
      || request.model.startsWith('model-router');
    const modelSupportsMinimalReasoning = supportsMinimalReasoning(request.model);

    let reasoningEffort: string | undefined;
    const requestedReasoningLevel = request.reasoningLevel;
    if (isGpt5Family) {
      const thinkingEnabled = request.thinkingEnabled ?? false;
      const reasoningLevel = requestedReasoningLevel ?? (modelSupportsMinimalReasoning
        ? (thinkingEnabled ? 'standard' : 'none')
        : (thinkingEnabled ? 'deep' : 'standard'));
      if (modelSupportsMinimalReasoning) {
        reasoningEffort = reasoningLevel === 'none' ? 'minimal' : reasoningLevel === 'deep' ? 'high' : 'medium';
      } else {
        reasoningEffort = reasoningLevel === 'none' ? 'none' : reasoningLevel === 'deep' ? 'high' : 'medium';
      }
    } else if (isOSeries) {
      const thinkingEnabled = request.thinkingEnabled ?? false;
      const reasoningLevel = requestedReasoningLevel ?? (thinkingEnabled ? 'deep' : 'standard');
      reasoningEffort = reasoningLevel === 'deep' ? 'high' : 'medium';
    }
    if (modelConfig?.reasoningEffort) {
      reasoningEffort = modelConfig.reasoningEffort === 'minimal'
        ? (modelSupportsMinimalReasoning ? 'minimal' : 'none')
        : modelConfig.reasoningEffort === 'low'
          ? 'low'
          : modelConfig.reasoningEffort;
    }

    // ── Responses API for reasoning calls (enables reasoning summaries) ──
    const shouldUseResponsesForCompaction = Boolean(contextManagement?.length);
    if (shouldForceResponsesApi(request.model) && hasResponsesApi) {
      return this.generateViaResponses(request, reasoningEffort, tools, contextManagement, useHostedToolSearch);
    }
    if ((reasoningEffort && reasoningEffort !== 'minimal' && hasResponsesApi) || (shouldUseResponsesForCompaction && hasResponsesApi)) {
      return this.generateViaResponses(request, reasoningEffort, tools, contextManagement, useHostedToolSearch);
    }

    // ── Chat Completions path (non-reasoning / reasoning=none / SDK fallback) ──
    const forceDefaultTemp = requiresDefaultTemperature(request.model);
    const forbidTempTopP = isOSeries || (isGpt5Family && reasoningEffort !== 'minimal');
    const useMaxCompletionTokens = isOSeries || isGpt5Family;
    const resolvedMaxTokens = request.maxTokens ?? (useMaxCompletionTokens
      ? (reasoningEffort && reasoningEffort !== 'minimal' ? 32768 : 16384)
      : undefined);

    const deploymentModel = this.azureDeploymentModel(request.model);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createParams: any = {
      model: deploymentModel,
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
            temperature: forceDefaultTemp ? 1 : (request.temperature ?? 0.7),
            ...(request.topP !== undefined ? { top_p: request.topP } : {}),
          }),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(modelConfig?.structuredOutput ? {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: modelConfig.structuredOutput.name,
            schema: normalizeSchemaTypes(modelConfig.structuredOutput.schema),
            strict: modelConfig.structuredOutput.strict ?? true,
          },
        },
      } : {}),
    };

    const response = await this.callWithAzureFallback(createParams) as OpenAI.Chat.Completions.ChatCompletion;
    return this.mapResponse(response);
  }

  /** Chat completions — Azure client or direct OpenAI client (never cross-over). */
  private async callWithAzureFallback(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    if (!this.isAzure) {
      return this.callDirectWithTierFallback(this.client, params);
    }

    return (await this.client.chat.completions.create(params)) as OpenAI.Chat.Completions.ChatCompletion;
  }

  private async callDirectWithTierFallback(
    client: OpenAI,
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const preferredTier = getPreferredDirectOpenAIServiceTier();
    const preferredParams = preferredTier
      ? { ...params, service_tier: preferredTier }
      : params;

    try {
      return await client.chat.completions.create(preferredParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) as OpenAI.Chat.Completions.ChatCompletion;
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (!preferredTier || !shouldRetryWithoutFlex(message)) {
        throw err;
      }

      console.warn(`[OpenAI] Flex unavailable for ${params.model} — retrying with standard tier`);
      return await client.chat.completions.create({
        ...params,
        service_tier: 'auto',
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) as OpenAI.Chat.Completions.ChatCompletion;
    }
  }

  // ─── Responses API (reasoning summaries) ────────────────────

  /**
   * Generate using the OpenAI Responses API — enables reasoning summaries.
   * Used for GPT-5 and o-series when reasoning is active.
   */
  private async generateViaResponses(
    request: UnifiedModelRequest,
    reasoningEffort?: string,
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
    contextManagement?: Array<Record<string, unknown>>,
    useHostedToolSearch = false,
  ): Promise<UnifiedModelResponse> {
    const input = this.mapConversationForResponses(request);

    // Responses API uses flat function objects, plus namespace/tool_search in hosted mode.
    const responsesTools = useHostedToolSearch && request.tools?.length
      ? buildOpenAITools(request.metadata?.agentRole, request.tools).map((tool) => {
          if (tool.type === 'function') {
            return {
              ...tool,
              parameters: normalizeSchemaTypes(tool.parameters),
            };
          }
          if (tool.type === 'namespace') {
            return {
              ...tool,
              tools: tool.tools.map((fn) => ({
                ...fn,
                parameters: normalizeSchemaTypes(fn.parameters),
              })),
            };
          }
          return tool;
        })
      : tools?.map(t => ({
          type: 'function' as const,
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        }));
    const modelConfig = request.metadata?.modelConfig;
    const includeReasoningSummary = /^(1|true|yes)$/i.test(process.env.OPENAI_REASONING_SUMMARY ?? '');
    const toolSearchTool = (!useHostedToolSearch && modelConfig?.enableToolSearch && request.model.endsWith('-deep-research'))
      ? [{ type: 'tool_search' as const }]
      : [];
    const webSearchTool = modelConfig?.enableWebSearch
      ? [{ type: 'web_search_preview' as const }]
      : [];
    const patchTool = modelConfig?.enableApplyPatch
      ? [{
          type: 'function' as const,
          name: 'apply_patch_call',
          description: 'Apply a V4A diff patch to existing GitHub repository files on a feature/agent-* branch. Prefer this over full-file rewrites for code edits.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              repo: { type: 'string', description: 'Repository name, such as glyphor-ai-company.' },
              branch: { type: 'string', description: 'Target feature branch. Must start with feature/agent-.' },
              commit_message: { type: 'string', description: 'Commit message describing the patch.' },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  version: { type: 'string', enum: ['v4a-diff-v1'] },
                  files: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        path: { type: 'string' },
                        operations: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              type: { type: 'string', enum: ['replace', 'insert_after', 'insert_before', 'delete', 'replace_entire'] },
                              oldText: { type: 'string' },
                              newText: { type: 'string' },
                              anchor: { type: 'string' },
                              occurrence: { type: 'number' },
                            },
                            required: ['type'],
                          },
                        },
                      },
                      required: ['path', 'operations'],
                    },
                  },
                },
                required: ['version', 'files'],
              },
            },
            required: ['repo', 'branch', 'commit_message', 'patch'],
          },
        }]
      : [];
    const deepResearchWebSearchTool = request.model.endsWith('-deep-research')
      ? [{ type: 'web_search_preview' as const }]
      : [];

    const maxOutputTokens = request.maxTokens ?? 32768;
    const deploymentModel = this.azureDeploymentModel(request.model);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createParams: any = {
      model: deploymentModel,
      instructions: request.systemInstruction,
      input,
      ...(reasoningEffort && reasoningEffort !== 'minimal'
        ? {
            reasoning: {
              effort: reasoningEffort,
              ...(includeReasoningSummary ? { summary: 'auto' } : {}),
            },
          }
        : {}),
      ...((responsesTools?.length || patchTool.length || toolSearchTool.length || webSearchTool.length || deepResearchWebSearchTool.length)
        ? { tools: [...(responsesTools ?? []), ...toolSearchTool, ...webSearchTool, ...deepResearchWebSearchTool, ...patchTool] }
        : {}),
      max_output_tokens: maxOutputTokens,
      // Do NOT pass previous_response_id — we always send the full
      // conversation via `input` items.  Combining both causes 400 errors
      // when the server-side state has function_calls with OpenAI-generated
      // IDs that don't match our synthetic call IDs.
      store: false,
      ...(contextManagement?.length ? { context_management: contextManagement } : {}),
      ...(modelConfig?.verbosity ? { text: { verbosity: modelConfig.verbosity } } : {}),
      ...(modelConfig?.structuredOutput ? {
        text: {
          ...(modelConfig.verbosity ? { verbosity: modelConfig.verbosity } : {}),
          format: {
            type: 'json_schema',
            name: modelConfig.structuredOutput.name,
            schema: normalizeSchemaTypes(modelConfig.structuredOutput.schema),
            strict: modelConfig.structuredOutput.strict ?? true,
          },
        },
      } : {}),
    };

    const response = await this.callResponsesWithFallback(createParams);
    return this.mapResponsesApiResponse(response);
  }

  /** Responses API — Azure or direct only (no cross-provider fallback). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async callResponsesWithFallback(params: any): Promise<any> {
    if (!this.isAzure) {
      return this.callResponsesWithTierFallback(this.client, params);
    }

    return await (this.client as any).responses.create(params);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async callResponsesWithTierFallback(client: OpenAI, params: any): Promise<any> {
    const preferredTier = getPreferredDirectOpenAIServiceTier();
    const preferredParams = preferredTier
      ? { ...params, service_tier: preferredTier }
      : params;

    try {
      return await (client as any).responses.create(preferredParams);
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (!preferredTier || !shouldRetryWithoutFlex(message)) throw err;
      console.warn(`[OpenAI] Flex unavailable for Responses API ${params.model} — retrying with standard tier`);
      return await (client as any).responses.create({ ...params, service_tier: 'auto' });
    }
  }

  /**
   * Map conversation history to Responses API input format.
   * System prompt goes in `instructions` (not in input). Assistant messages
   * use output-item format. Tool calls map to function_call / function_call_output.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapConversationForResponses(request: UnifiedModelRequest): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any[] = [];
    const turns = request.contents;
    let i = 0;
    let toolCallCounter = 0;
    let lastCallIds: string[] = [];

    while (i < turns.length) {
      const turn = turns[i];
      switch (turn.role) {
        case 'user': {
          if (turn.attachments?.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parts: any[] = [];
            if (turn.content) parts.push({ type: 'input_text', text: turn.content });
            for (const att of turn.attachments) {
              if (att.mimeType.startsWith('image/')) {
                parts.push({ type: 'input_image', image_url: `data:${att.mimeType};base64,${att.data}` });
              } else if (att.mimeType === 'application/pdf') {
                parts.push({ type: 'input_file', file_data: `data:${att.mimeType};base64,${att.data}` });
              } else {
                const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
                const content = decoded.length > 50000 ? decoded.slice(0, 50000) + '\n...(truncated)' : decoded;
                parts.push({ type: 'input_text', text: `[File: ${att.name}]\n\`\`\`\n${content}\n\`\`\`` });
              }
            }
            input.push({ role: 'user', content: parts });
          } else {
            input.push({ role: 'user', content: turn.content });
          }
          i++;
          break;
        }
        case 'assistant':
          // Responses API requires output-item format for assistant messages
          input.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: turn.content }],
          });
          i++;
          break;
        case 'tool_call': {
          lastCallIds = [];
          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            const callId = `call_${toolCallCounter}_${(tc.toolName ?? '').slice(0, 20)}`.slice(0, 40);
            toolCallCounter++;
            lastCallIds.push(callId);
            input.push({
              type: 'function_call',
              id: `fc_${toolCallCounter}`,
              call_id: callId,
              name: tc.toolName!,
              arguments: JSON.stringify(tc.toolParams ?? {}),
            });
            i++;
          }
          break;
        }
        case 'tool_result': {
          if (lastCallIds.length === 0) {
            // Orphaned tool_result with no preceding tool_call — fold into
            // a plain text user message so OpenAI doesn't reject it.
            const textParts: string[] = [];
            while (i < turns.length && turns[i].role === 'tool_result') {
              const tr = turns[i];
              textParts.push(`[Prior tool result — ${tr.toolName ?? 'tool'}]: ${tr.content}`);
              i++;
            }
            input.push({ role: 'user', content: textParts.join('\n\n') });
            break;
          }
          let resultIndex = 0;
          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            const callId = resultIndex < lastCallIds.length
              ? lastCallIds[resultIndex]
              : `call_fallback_${resultIndex}_${(tr.toolName ?? '').slice(0, 15)}`.slice(0, 40);
            const isError = tr.toolResult?.success === false;
            input.push({
              type: 'function_call_output',
              call_id: callId,
              output: isError ? `[ERROR] ${tr.content}` : tr.content,
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

    // Merge consecutive user messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged: any[] = [];
    for (const item of input) {
      const prev = merged[merged.length - 1];
      if (prev?.role === 'user' && item.role === 'user') {
        const prevParts = Array.isArray(prev.content)
          ? prev.content
          : [{ type: 'input_text', text: prev.content as string }];
        const curParts = Array.isArray(item.content)
          ? item.content
          : [{ type: 'input_text', text: item.content as string }];
        prev.content = [...prevParts, ...curParts];
      } else {
        merged.push(item);
      }
    }

    return merged;
  }

  /**
   * Map Responses API response to unified format.
   * Extracts text, tool calls, and reasoning summaries.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapResponsesApiResponse(response: any): UnifiedModelResponse {
    let text: string | null = null;
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const providerEvents: Array<{ type: string; name?: string; payload?: string }> = [];
    let thinkingText: string | undefined;
    const compaction = extractOpenAICompactionMetadata(response);

    for (const item of (response.output ?? [])) {
      if (item.type === 'message') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textParts = (item.content ?? [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text);
        if (textParts.length > 0) {
          text = (text ?? '') + textParts.join('');
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          name: item.name,
          args: JSON.parse(item.arguments || '{}') as Record<string, unknown>,
        });
      } else if (item.type === 'tool_search_call' || item.type === 'tool_search_output') {
        providerEvents.push({
          type: item.type,
          name: item.name,
          payload: JSON.stringify(item).slice(0, 2000),
        });
      } else if (item.type === 'reasoning') {
        // Extract reasoning summary (the model's chain-of-thought summary)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const summaryParts = (item.summary ?? [])
          .filter((s: any) => s.type === 'summary_text')
          .map((s: any) => s.text);
        if (summaryParts.length > 0) {
          thinkingText = (thinkingText ?? '') + summaryParts.join('\n');
        }
      }
    }

    const usage = response.usage ?? {};
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
    const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;

    // Determine finish reason from response status
    let finishReason = 'stop';
    if (response.status === 'incomplete') {
      finishReason = response.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'stop';
    } else if (toolCalls.length > 0) {
      finishReason = 'tool_use';
    }

    return {
      text,
      toolCalls,
      ...(providerEvents.length > 0 ? { providerEvents } : {}),
      thinkingText,
      usageMetadata: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        thinkingTokens: reasoningTokens || undefined,
        cachedInputTokens: cachedTokens || undefined,
      },
      finishReason,
      responseId: response.id,
      compactionOccurred: compaction?.occurred,
      compactionCount: compaction?.count,
      compactionSummary: compaction?.summary,
    };
  }

  /**
   * Generate an image using OpenAI gpt-image-1.5 (text-rich infographics).
   * Uses direct fetch instead of the SDK to avoid connection issues in Cloud Run.
   * Routes through Azure OpenAI when configured; otherwise direct OpenAI.
   */
  async generateImage(prompt: string, model = 'gpt-image-1.5', aspectRatio = '16:9'): Promise<ImageResponse> {
    // Map aspect ratios to OpenAI sizes
    const sizeMap: Record<string, string> = {
      '16:9': '1536x1024',
      '4:3': '1024x768',
      '3:4': '768x1024',
      '1:1': '1024x1024',
      '9:16': '1024x1536',
    };
    const size = sizeMap[aspectRatio] ?? '1536x1024';

    const body = JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
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
    // Use 'developer' role for GPT-5, model-router, and o-series (router may invoke GPT-5 / reasoning models)
    const systemRole = (request.model.startsWith('gpt-5') || request.model === 'model-router' || /^o[134](-|$)/.test(request.model))
      ? 'developer'
      : 'system';
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: systemRole as 'system', content: request.systemInstruction },
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
          if (lastToolCallIds.length === 0) {
            // Orphaned tool_result with no preceding tool_call — fold into
            // a plain text user message so OpenAI doesn't reject it.
            const textParts: string[] = [];
            while (i < turns.length && turns[i].role === 'tool_result') {
              const tr = turns[i];
              textParts.push(`[Prior tool result — ${tr.toolName ?? 'tool'}]: ${tr.content}`);
              i++;
            }
            messages.push({ role: 'user', content: textParts.join('\n\n') });
            break;
          }
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
      responseId: response.id,
    };
  }
}
