/**
 * DeepSeek on Amazon Bedrock.
 *  - R1: InvokeModel completion format (no tool support).
 *  - V3.2: OpenAI-compatible messages + tool calling via Bedrock Marketplace.
 */

import { getBedrockInferenceId } from '@glyphor/shared';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse } from './types.js';
import { invokeBedrockModel } from './bedrockClient.js';

function flattenConversationToDeepSeekR1Prompt(
  systemInstruction: string,
  turns: ConversationTurn[],
): string {
  const parts: string[] = [];
  if (systemInstruction.trim()) {
    parts.push(systemInstruction.trim());
  }
  for (const t of turns) {
    if (t.role === 'user') parts.push(`User: ${t.content ?? ''}`);
    else if (t.role === 'assistant') parts.push(`Assistant: ${t.content ?? ''}`);
    else if (t.role === 'tool_call') parts.push(`[tool ${t.toolName}]`);
    else if (t.role === 'tool_result') parts.push(`[tool result]: ${t.content}`);
  }
  const joined = parts.join('\n\n');
  return `<｜begin_of_sentence｜><|User|>${joined}<|Assistant|>`;
}

/**
 * Convert conversation turns to OpenAI-compatible messages with proper
 * tool_call / tool role handling for DeepSeek V3.2.
 */
function turnsToMessages(
  systemInstruction: string,
  turns: ConversationTurn[],
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (systemInstruction.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }

  let i = 0;
  let lastToolCallIds: string[] = [];
  let toolCallCounter = 0;

  while (i < turns.length) {
    const t = turns[i];
    switch (t.role) {
      case 'user':
        messages.push({ role: 'user', content: t.content ?? '' });
        i++;
        break;
      case 'assistant':
        messages.push({ role: 'assistant', content: t.content ?? '' });
        i++;
        break;
      case 'tool_call': {
        const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
        lastToolCallIds = [];
        while (i < turns.length && turns[i].role === 'tool_call') {
          const tc = turns[i];
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
        messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
        break;
      }
      case 'tool_result': {
        if (lastToolCallIds.length === 0) {
          const textParts: string[] = [];
          while (i < turns.length && turns[i].role === 'tool_result') {
            textParts.push(`[Prior tool result — ${turns[i].toolName ?? 'tool'}]: ${turns[i].content}`);
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
          const isError = tr.toolResult?.success === false;
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: isError ? `[ERROR] ${tr.content}` : tr.content,
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

  // Ensure there's at least one user message
  if (!messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user', content: '' });
  }
  return messages;
}

export class BedrockDeepSeekAdapter implements ProviderAdapter {
  readonly provider = 'deepseek' as const;

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const bedrockModelId = getBedrockInferenceId(request.model) ?? request.model;
    const isR1 = request.model.startsWith('deepseek-r1');

    if (isR1) {
      const prompt = flattenConversationToDeepSeekR1Prompt(request.systemInstruction, request.contents);
      const body = {
        prompt,
        max_tokens: Math.min(request.maxTokens ?? 4096, 8192),
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.9,
      };
      const { bodyJson } = await invokeBedrockModel(bedrockModelId, JSON.stringify(body));
      return this.mapCompletionResponse(bodyJson);
    }

    // DeepSeek V3.2 — Bedrock Marketplace model uses OpenAI-compatible messages format
    const messages = turnsToMessages(request.systemInstruction, request.contents);

    // Build OpenAI-compatible tools array
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

    const body: Record<string, unknown> = {
      messages,
      max_tokens: Math.min(request.maxTokens ?? 4096, 8192),
      temperature: request.temperature ?? 0.5,
      top_p: request.topP ?? 0.9,
      ...(tools ? { tools } : {}),
    };
    const { bodyJson } = await invokeBedrockModel(bedrockModelId, JSON.stringify(body));
    return this.mapMessagesResponse(bodyJson);
  }

  private mapCompletionResponse(bodyJson: Record<string, unknown>): UnifiedModelResponse {
    const choices = bodyJson.choices as Array<{ text?: string; stop_reason?: string }> | undefined;
    const text = choices?.[0]?.text ?? null;
    const stopReason = choices?.[0]?.stop_reason ?? 'stop';
    const usage = bodyJson.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    return {
      text,
      toolCalls: [],
      usageMetadata: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: stopReason === 'length' ? 'length' : 'stop',
    };
  }

  /** Map OpenAI-compatible messages response (DeepSeek V3.2 Marketplace format). */
  private mapMessagesResponse(bodyJson: Record<string, unknown>): UnifiedModelResponse {
    const choices = bodyJson.choices as Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name: string; arguments: string };
        }>;
      };
      finish_reason?: string;
    }> | undefined;
    const message = choices?.[0]?.message;
    const text = message?.content ?? null;
    const finishReason = choices?.[0]?.finish_reason ?? 'stop';

    // Parse tool calls from the response
    const toolCalls = (message?.tool_calls ?? []).map(tc => ({
      name: tc.function?.name ?? '',
      args: JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>,
    }));

    const usage = bodyJson.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | undefined;
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    return {
      text,
      toolCalls,
      usageMetadata: {
        inputTokens,
        outputTokens,
        totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
      },
      finishReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'length' ? 'length' : 'stop',
    };
  }
}
