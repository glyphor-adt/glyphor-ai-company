/**
 * Anthropic Claude via Amazon Bedrock (InvokeModel) — no api.anthropic.com and no ANTHROPIC_API_KEY.
 * Auth is AWS only (default credential chain: aws login, SSO, ~/.aws, IAM keys).
 */

import { getBedrockInferenceId } from '@glyphor/shared';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse } from './types.js';
import { extractAnthropicCompactionMetadata } from '../compaction.js';
import { buildAnthropicTools } from '../anthropicToolBuilder.js';
import { shouldUseAnthropicToolSearch } from '../toolSearchConfig.js';
import { mapConversationToAnthropicMessages } from './anthropicConversation.js';
import { invokeBedrockModel } from './bedrockClient.js';

// Model capability detection
const isOpus47 = (model: string) => /claude-opus-4-7/.test(model);
const isOpus4Family = (model: string) => /claude-opus-4/.test(model);
const supportsThinking = (model: string) => /claude-(3-[5-9]|[4-9]|sonnet-4|haiku-4|opus-4)/.test(model);
const supportsTaskBudget = (model: string) => isOpus47(model); // Opus 4.7 public beta only
const supportsXhighEffort = (model: string) => isOpus47(model); // xhigh is 4.7-specific

// Opus 4.7 tokenizer produces 1.0-1.35x more tokens vs 4.6
// Bump default max_tokens to compensate for headroom
const DEFAULT_MAX_TOKENS_OPUS47 = 24576;
const DEFAULT_MAX_TOKENS_CLAUDE = 16384;

export class BedrockAnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const modelConfig = request.metadata?.modelConfig;
    const messages = mapConversationToAnthropicMessages(request.contents);
    const useHostedToolSearch = shouldUseAnthropicToolSearch(request.model);

    // Tool definitions (with cache_control on the last tool for caching the tool block)
    const rawTools = request.tools?.length
      ? (useHostedToolSearch
        ? buildAnthropicTools(request.metadata?.agentRole, request.tools)
        : request.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: {
              type: 'object' as const,
              properties: t.parameters.properties,
              required: t.parameters.required,
            },
          })))
      : undefined;

    // Cache the tool block when tools are large (>1024 tokens is the rough threshold
    // where caching wins). Conservative heuristic: cache when 3+ tools defined.
    const tools = rawTools && rawTools.length >= 3
      ? rawTools.map((t, i) => i === rawTools.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' as const } }
          : t)
      : rawTools;

    const thinkingEnabled = request.thinkingEnabled ?? false;
    const reasoningLevel = request.reasoningLevel ?? (thinkingEnabled ? 'deep' : 'none');
    const thinkingOk = supportsThinking(request.model);
    const configuredEffort = modelConfig?.claudeEffort ?? modelConfig?.reasoningEffort;
    const useThinking = (configuredEffort ? configuredEffort !== 'low' : reasoningLevel !== 'none') && thinkingOk;

    const thinkingBudget = configuredEffort === 'high' || reasoningLevel === 'deep'
      ? 8192
      : configuredEffort === 'medium'
        ? 4096
        : 2048;

    const isOpus47Model = isOpus47(request.model);
    const isOpus4 = isOpus4Family(request.model);

    const thinkingParam = useThinking
      ? { thinking: (modelConfig?.claudeThinking === 'adaptive' || isOpus4)
          ? { type: 'adaptive' as const }
          : { type: 'enabled' as const, budget_tokens: thinkingBudget }
        }
      : {};

    // Opus 4.7 gets a bumped default for the new tokenizer
    const defaultMaxTokens = isOpus47Model ? DEFAULT_MAX_TOKENS_OPUS47 : DEFAULT_MAX_TOKENS_CLAUDE;
    const maxTokens = (useThinking && !isOpus4)
      ? Math.max(request.maxTokens ?? defaultMaxTokens, thinkingBudget + 4096)
      : (request.maxTokens ?? defaultMaxTokens);

    const supplementalInstructions = [
      modelConfig?.enableCitations ? 'When you reference retrieved evidence, include concise inline citations to the source material.' : null,
      modelConfig?.enableCompaction ? 'Favor compact, high-signal answers and avoid repeating context verbatim.' : null,
      modelConfig?.structuredOutput
        ? `Return valid JSON matching this schema exactly: ${JSON.stringify(modelConfig.structuredOutput.schema)}`
        : null,
    ].filter(Boolean);

    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
    if (request.systemInstruction.trim()) {
      systemBlocks.push({
        type: 'text',
        text: request.systemInstruction,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (supplementalInstructions.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: supplementalInstructions.join('\n\n'),
        ...(systemBlocks.length < 2 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      });
    }

    const bedrockModelId = getBedrockInferenceId(request.model) ?? request.model;

    const body: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages,
      ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
      ...(tools ? { tools } : {}),
      temperature: useThinking ? 1 : (request.temperature ?? 0.7),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...thinkingParam,
    };

    // ========== Opus 4.7 effort defaults ==========
    // Opus 4.7 changes defaults: xhigh is the recommended baseline for coding/agentic.
    // If caller didn't specify effort, default to xhigh for 4.7.
    // Other Opus 4.x models fall back to whatever was configured (or omit).
    const resolvedEffort = modelConfig?.claudeEffort
      ?? (isOpus47Model ? 'xhigh' : undefined);

    if (resolvedEffort) {
      body.output_config = {
        ...(body.output_config as Record<string, unknown> | undefined),
        effort: resolvedEffort,
      };
    }

    // ========== Task budget for Opus 4.7 ==========
    // Gives Claude a rough token ceiling for the full agentic loop.
    // Model sees a countdown and self-prioritizes.
    const taskBudget = modelConfig?.taskBudget;
    if (taskBudget && supportsTaskBudget(request.model)) {
      body.task_budget = taskBudget;
    }

    if (modelConfig?.structuredOutput) {
      body.output_config = {
        ...(body.output_config as Record<string, unknown> | undefined),
        format: {
          type: 'json_schema',
          schema: modelConfig.structuredOutput.schema,
        },
      };
    }

    // ========== Beta headers for task budget ==========
    // task_budget is currently public beta — requires beta header.
    // On Bedrock, anthropic-beta is injected into the body as anthropic_beta.
    const betaHeaders: string[] = [];
    if (taskBudget && supportsTaskBudget(request.model)) {
      betaHeaders.push('task-budgets-2026-04-16');
    }

    const { bodyJson } = await invokeBedrockModel(
      bedrockModelId,
      JSON.stringify(body),
      betaHeaders.length > 0 ? { 'anthropic-beta': betaHeaders.join(',') } : undefined,
    );
    return this.mapAnthropicResponse(bodyJson);
  }

  private normalizeFinishReason(reason?: string | null): string {
    if (!reason) return 'stop';
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
      case 'task_budget_exceeded': return 'budget_exceeded';
      default: return reason;
    }
  }

  private mapAnthropicResponse(response: Record<string, unknown>): UnifiedModelResponse {
    let text: string | null = null;
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    const providerEvents: Array<{ type: string; name?: string; payload?: string }> = [];
    let thinkingText: string | undefined;
    const compaction = extractAnthropicCompactionMetadata(response);

    const content = Array.isArray(response.content) ? response.content as Array<Record<string, unknown>> : [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text = (text ?? '') + block.text;
      } else if (block.type === 'compaction') {
        continue;
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        toolCalls.push({
          name: block.name,
          args: (block.input as Record<string, unknown>) ?? {},
        });
      } else if (block.type === 'server_tool_use' && typeof block.name === 'string') {
        providerEvents.push({
          type: 'server_tool_use',
          name: block.name,
          payload: JSON.stringify(block).slice(0, 2000),
        });
      } else if (block.type === 'tool_search_tool_result') {
        providerEvents.push({
          type: 'tool_search_tool_result',
          payload: JSON.stringify(block).slice(0, 2000),
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        thinkingText = (thinkingText ?? '') + block.thinking;
      }
    }

    const usageRaw = response.usage as Record<string, number> | undefined;
    const usageIterations = Array.isArray((response.usage as { iterations?: unknown[] } | undefined)?.iterations)
      ? ((response.usage as { iterations: Array<Record<string, number>> }).iterations)
      : [];
    const iterationInputTokens = usageIterations.reduce((sum, iteration) => sum + (iteration.input_tokens ?? 0), 0);
    const iterationOutputTokens = usageIterations.reduce((sum, iteration) => sum + (iteration.output_tokens ?? 0), 0);
    const cacheCreation = usageRaw?.cache_creation_input_tokens ?? 0;
    const cacheRead = usageRaw?.cache_read_input_tokens ?? 0;
    const cachedInputTokens = cacheCreation + cacheRead;
    const inputTokens = (usageRaw?.input_tokens ?? 0) + iterationInputTokens;
    const outputTokens = (usageRaw?.output_tokens ?? 0) + iterationOutputTokens;

    return {
      text,
      toolCalls,
      ...(providerEvents.length > 0 ? { providerEvents } : {}),
      thinkingText,
      usageMetadata: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedInputTokens: cachedInputTokens || undefined,
      },
      finishReason: this.normalizeFinishReason(response.stop_reason as string | undefined),
      compactionOccurred: compaction?.occurred,
      compactionCount: compaction?.count,
      compactionSummary: compaction?.summary,
    };
  }
}
