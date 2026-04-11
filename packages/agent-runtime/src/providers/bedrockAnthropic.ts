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

export class BedrockAnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const modelConfig = request.metadata?.modelConfig;
    const messages = mapConversationToAnthropicMessages(request.contents);
    const useHostedToolSearch = shouldUseAnthropicToolSearch(request.model);
    const tools = request.tools?.length
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

    const thinkingEnabled = request.thinkingEnabled ?? false;
    const reasoningLevel = request.reasoningLevel ?? (thinkingEnabled ? 'deep' : 'none');
    const supportsThinking = /claude-(3-[5-9]|[4-9]|sonnet-4|haiku-4|opus-4)/.test(request.model);
    const configuredEffort = modelConfig?.claudeEffort ?? modelConfig?.reasoningEffort;
    const useThinking = (configuredEffort ? configuredEffort !== 'low' : reasoningLevel !== 'none') && supportsThinking;
    const thinkingBudget = configuredEffort === 'high' || reasoningLevel === 'deep'
      ? 8192
      : configuredEffort === 'medium'
        ? 4096
        : 2048;
    const isOpus4 = /claude-opus-4/.test(request.model);
    const thinkingParam = useThinking
      ? { thinking: (modelConfig?.claudeThinking === 'adaptive' || isOpus4)
          ? { type: 'adaptive' as const }
          : { type: 'enabled' as const, budget_tokens: thinkingBudget }
        }
      : {};

    const maxTokens = (useThinking && !isOpus4)
      ? Math.max(request.maxTokens ?? 16384, thinkingBudget + 4096)
      : (request.maxTokens ?? 16384);

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

    if (modelConfig?.claudeEffort) {
      body.output_config = {
        effort: modelConfig.claudeEffort,
      };
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

    const { bodyJson } = await invokeBedrockModel(bedrockModelId, JSON.stringify(body));
    return this.mapAnthropicResponse(bodyJson);
  }

  private normalizeFinishReason(reason?: string | null): string {
    if (!reason) return 'stop';
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_use';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
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
