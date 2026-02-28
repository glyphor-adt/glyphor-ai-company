/**
 * Anthropic Provider Adapter — Maps Anthropic API to unified types.
 *
 * Supports Claude 3.5+, Claude Sonnet 4, Haiku 4, and Opus 4 with
 * extended thinking (manual or adaptive depending on model).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn } from '../types.js';
import type { ProviderAdapter, UnifiedModelRequest, UnifiedModelResponse } from './types.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const messages = this.mapConversation(request.contents);

    const tools = request.tools?.length
      ? request.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object' as const,
            properties: t.parameters.properties,
            required: t.parameters.required,
          },
        }))
      : undefined;

    // Extended thinking config
    const thinkingEnabled = request.thinkingEnabled ?? false;
    const supportsThinking = /claude-(3-[5-9]|[4-9]|sonnet-4|haiku-4|opus-4)/.test(request.model);
    const useThinking = thinkingEnabled && supportsThinking;
    const thinkingBudget = 8192;
    // claude-opus-4 requires adaptive thinking
    const isOpus4 = /claude-opus-4/.test(request.model);
    const thinkingParam = useThinking
      ? { thinking: isOpus4
          ? { type: 'adaptive' as const, effort: 'medium' as const }
          : { type: 'enabled' as const, budget_tokens: thinkingBudget }
        }
      : {};

    // Anthropic requires max_tokens > budget_tokens when manual thinking is enabled
    const maxTokens = (useThinking && !isOpus4)
      ? Math.max(request.maxTokens ?? 16384, thinkingBudget + 4096)
      : (request.maxTokens ?? 16384);

    const response = await this.client.messages.create({
      model: request.model,
      system: request.systemInstruction,
      messages,
      ...(tools ? { tools } : {}),
      max_tokens: maxTokens,
      temperature: useThinking ? 1 : (request.temperature ?? 0.7),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...thinkingParam,
    } as Parameters<typeof this.client.messages.create>[0]);

    return this.mapResponse(response as Anthropic.Message);
  }

  private mapConversation(turns: ConversationTurn[]): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];
    let i = 0;
    let lastToolUseIds: string[] = [];

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
                parts.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: att.data } });
              } else if (att.mimeType === 'application/pdf') {
                parts.push({ type: 'document', source: { type: 'base64', media_type: att.mimeType, data: att.data } });
              } else {
                // Text-based files: decode and inject as text
                const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
                const content = decoded.length > 50000 ? decoded.slice(0, 50000) + '\n...(truncated)' : decoded;
                parts.push({ type: 'text', text: `[File: ${att.name}]\n\`\`\`\n${content}\n\`\`\`` });
              }
            }
            messages.push({ role: 'user', content: parts });
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
          const content: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
          lastToolUseIds = [];
          while (i < turns.length && turns[i].role === 'tool_call') {
            const tc = turns[i];
            const id = `call_${tc.toolName}_${tc.timestamp}`;
            lastToolUseIds.push(id);
            content.push({
              type: 'tool_use',
              id,
              name: tc.toolName!,
              input: (tc.toolParams ?? {}) as Record<string, unknown>,
            });
            i++;
          }
          messages.push({ role: 'assistant', content });
          break;
        }
        case 'tool_result': {
          const content: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
          let resultIndex = 0;
          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            const toolUseId = resultIndex < lastToolUseIds.length
              ? lastToolUseIds[resultIndex]
              : `call_${tr.toolName}_${tr.timestamp}`;
            content.push({
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: tr.content,
            });
            resultIndex++;
            i++;
          }
          messages.push({ role: 'user', content });
          break;
        }
        default:
          i++;
      }
    }

    // Anthropic requires strict user/assistant alternation.
    // Merge consecutive same-role messages to avoid API errors.
    const merged: Anthropic.MessageParam[] = [];
    for (const msg of messages) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === msg.role) {
        // Convert both to content-block arrays and concatenate
        const prevParts = Array.isArray(prev.content)
          ? prev.content
          : [{ type: 'text' as const, text: prev.content as string }];
        const curParts = Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text' as const, text: msg.content as string }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prev.content = [...prevParts, ...curParts] as any;
      } else {
        merged.push({ ...msg });
      }
    }

    return merged;
  }

  /** Normalize Anthropic stop reasons to a consistent set: stop | tool_use | length */
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

  private mapResponse(response: Anthropic.Message): UnifiedModelResponse {
    let text: string | null = null;
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    let thinkingText: string | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        text = (text ?? '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          args: (block.input as Record<string, unknown>) ?? {},
        });
      } else if (block.type === 'thinking') {
        thinkingText = (thinkingText ?? '') + (block as { thinking: string }).thinking;
      }
    }

    return {
      text,
      toolCalls,
      thinkingText,
      usageMetadata: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: this.normalizeFinishReason(response.stop_reason),
    };
  }
}
