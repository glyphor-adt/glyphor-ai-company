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

    // DeepSeek V3.2 — AWS model card uses deepseek.v3.2 with messages-style in some examples; use prompt completion
    const prompt = flattenConversationToDeepSeekR1Prompt(request.systemInstruction, request.contents);
    const body = {
      prompt,
      max_tokens: Math.min(request.maxTokens ?? 4096, 8192),
      temperature: request.temperature ?? 0.5,
      top_p: request.topP ?? 0.9,
    };
    const { bodyJson } = await invokeBedrockModel(bedrockModelId, JSON.stringify(body));
    return this.mapCompletionResponse(bodyJson);
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
}
