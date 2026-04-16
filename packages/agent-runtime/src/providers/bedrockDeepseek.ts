/**
 * DeepSeek on Amazon Bedrock (InvokeModel completion format for R1; V3.2 similar).
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
 * Convert conversation turns to the OpenAI-compatible messages format
 * required by DeepSeek V3.2 on Bedrock Marketplace.
 */
function turnsToMessages(
  systemInstruction: string,
  turns: ConversationTurn[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemInstruction.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }
  for (const t of turns) {
    if (t.role === 'user') {
      messages.push({ role: 'user', content: t.content ?? '' });
    } else if (t.role === 'assistant') {
      messages.push({ role: 'assistant', content: t.content ?? '' });
    } else if (t.role === 'tool_call') {
      messages.push({ role: 'assistant', content: `[tool ${t.toolName}]` });
    } else if (t.role === 'tool_result') {
      messages.push({ role: 'user', content: `[tool result]: ${t.content}` });
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
    const body = {
      messages,
      max_tokens: Math.min(request.maxTokens ?? 4096, 8192),
      temperature: request.temperature ?? 0.5,
      top_p: request.topP ?? 0.9,
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
      message?: { content?: string };
      finish_reason?: string;
    }> | undefined;
    const text = choices?.[0]?.message?.content ?? null;
    const finishReason = choices?.[0]?.finish_reason ?? 'stop';
    const usage = bodyJson.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | undefined;
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    return {
      text,
      toolCalls: [],
      usageMetadata: {
        inputTokens,
        outputTokens,
        totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
      },
      finishReason: finishReason === 'length' ? 'length' : 'stop',
    };
  }
}
