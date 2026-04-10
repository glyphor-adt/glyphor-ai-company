/**
 * Anthropic Messages API shapes (Bedrock-compatible) — no @anthropic-ai/sdk dependency.
 */

import type { ConversationTurn } from '../types.js';

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

export function mapConversationToAnthropicMessages(turns: ConversationTurn[]): AnthropicMessageParam[] {
  const messages: AnthropicMessageParam[] = [];
  let i = 0;
  let lastToolUseIds: string[] = [];

  while (i < turns.length) {
    const turn = turns[i];
    switch (turn.role) {
      case 'user': {
        lastToolUseIds = [];
        if (turn.attachments?.length) {
          const parts: AnthropicContentBlock[] = [];
          if (turn.content) parts.push({ type: 'text', text: turn.content });
          for (const att of turn.attachments) {
            if (att.mimeType.startsWith('image/')) {
              parts.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: att.data } });
            } else if (att.mimeType === 'application/pdf') {
              parts.push({ type: 'document', source: { type: 'base64', media_type: att.mimeType, data: att.data } });
            } else {
              const decoded = Buffer.from(att.data, 'base64').toString('utf-8');
              const content = decoded.length > 50000 ? `${decoded.slice(0, 50000)}\n...(truncated)` : decoded;
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
        lastToolUseIds = [];
        messages.push({ role: 'assistant', content: turn.content });
        i++;
        break;
      case 'tool_call': {
        const content: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
        lastToolUseIds = [];
        let callIdx = 0;
        while (i < turns.length && turns[i].role === 'tool_call') {
          const tc = turns[i];
          const id = `call_${tc.toolName}_${tc.timestamp}_${callIdx++}`;
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
        if (lastToolUseIds.length === 0) {
          const textParts: string[] = [];
          while (i < turns.length && turns[i].role === 'tool_result') {
            const tr = turns[i];
            textParts.push(`[Prior tool result — ${tr.toolName ?? 'tool'}]: ${tr.content}`);
            i++;
          }
          messages.push({ role: 'user', content: textParts.join('\n\n') });
          break;
        }
        const content: Array<
          | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
          | { type: 'text'; text: string }
        > = [];
        let resultIndex = 0;
        while (i < turns.length && turns[i].role === 'tool_result') {
          const tr = turns[i];
          if (resultIndex < lastToolUseIds.length) {
            const isError = tr.toolResult?.success === false;
            content.push({
              type: 'tool_result',
              tool_use_id: lastToolUseIds[resultIndex],
              content: tr.content,
              ...(isError && { is_error: true }),
            });
          } else {
            content.push({
              type: 'text',
              text: `[Prior tool result — ${tr.toolName ?? 'tool'}]: ${tr.content}`,
            });
          }
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

  const merged: AnthropicMessageParam[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      const prevParts = Array.isArray(prev.content)
        ? prev.content
        : [{ type: 'text' as const, text: prev.content as string }];
      const curParts = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text' as const, text: msg.content as string }];
      prev.content = [...prevParts, ...curParts] as AnthropicMessageParam['content'];
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}
