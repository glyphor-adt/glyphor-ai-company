import type { ConversationTurn } from './types.js';

export interface HistoryCompressionConfig {
  maxHistoryTokens: number;
  keepRecentTurns: number;
  toolResultMaxTokens: number;
  summarizeToolResults: boolean;
}

export const DEFAULT_HISTORY_COMPRESSION: HistoryCompressionConfig = {
  maxHistoryTokens: 8_000,
  keepRecentTurns: 2,
  toolResultMaxTokens: 400,
  summarizeToolResults: true,
};

function estimateTokens(history: ConversationTurn[]): number {
  // Divide by 3 instead of 4 — closer to real tokenizer output for
  // mixed code/prose/JSON typical of agent conversations.
  return Math.ceil(history.reduce((total, turn) => total + turn.content.length, 0) / 3);
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildCompressedSummary(
  olderTurns: ConversationTurn[],
  config: HistoryCompressionConfig,
): ConversationTurn {
  const lines: string[] = [
    '# Compressed prior context',
    'Older conversation history was compressed to stay within the runtime token budget.',
  ];

  const priorRequests = olderTurns
    .filter((turn) => turn.role === 'user')
    .slice(-3)
    .map((turn) => `- ${clip(turn.content.replace(/\s+/g, ' ').trim(), 220)}`);
  if (priorRequests.length > 0) {
    lines.push('', '## Prior requests', ...priorRequests);
  }

  const priorResponses = olderTurns
    .filter((turn) => turn.role === 'assistant')
    .slice(-2)
    .map((turn) => `- ${clip(turn.content.replace(/\s+/g, ' ').trim(), 220)}`);
  if (priorResponses.length > 0) {
    lines.push('', '## Prior responses', ...priorResponses);
  }

  const toolCalls = Array.from(
    new Set(
      olderTurns
        .filter((turn) => turn.role === 'tool_call' && turn.toolName)
        .map((turn) => turn.toolName as string),
    ),
  );
  if (toolCalls.length > 0) {
    lines.push('', `## Tools already used`, `- ${toolCalls.join(', ')}`);
  }

  if (config.summarizeToolResults) {
    const toolResults = olderTurns
      .filter((turn) => turn.role === 'tool_result')
      .slice(-4)
      .map((turn) => `- ${turn.toolName ?? 'tool'}: ${clip(turn.content.replace(/\s+/g, ' ').trim(), config.toolResultMaxTokens)}`);
    if (toolResults.length > 0) {
      lines.push('', '## Tool result snapshots', ...toolResults);
    }
  }

  return {
    role: 'user',
    content: lines.join('\n'),
    timestamp: olderTurns.at(-1)?.timestamp ?? Date.now(),
  };
}

/**
 * Remove orphaned tool_call / tool_result turns that lost their pair
 * during history compression. Anthropic's API requires every tool_result
 * to reference a tool_use block in the preceding assistant message;
 * unpaired turns cause 400 errors.
 */
function sanitizeToolPairs(turns: ConversationTurn[]): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let i = 0;
  while (i < turns.length) {
    if (turns[i].role === 'tool_result') {
      // tool_result without a preceding tool_call group — orphaned, skip
      i++;
      continue;
    }
    if (turns[i].role === 'tool_call') {
      // Collect consecutive tool_call turns
      const groupStart = i;
      while (i < turns.length && turns[i].role === 'tool_call') i++;
      const callCount = i - groupStart;
      // Check if followed by tool_result turns
      const resultStart = i;
      while (i < turns.length && turns[i].role === 'tool_result') i++;
      const resultCount = i - resultStart;
      if (resultCount > 0) {
        // Both halves present — keep balanced pairs to enforce count parity.
        // Compression can split a tool group, leaving fewer calls than results
        // (or vice-versa); excess items would produce fabricated IDs that the
        // LLM provider rejects.
        const pairCount = Math.min(callCount, resultCount);
        for (let j = groupStart; j < groupStart + pairCount; j++) result.push(turns[j]);
        for (let j = resultStart; j < resultStart + pairCount; j++) result.push(turns[j]);
      }
      // else: tool_calls with no results — drop them
      continue;
    }
    result.push(turns[i]);
    i++;
  }
  return result;
}

function truncateOlderToolResults(
  turns: ConversationTurn[],
  maxTokens: number,
): ConversationTurn[] {
  // Truncate ALL tool results — even recent ones — to cap per-turn size.
  // The most recent tool_result gets 2x budget so the agent can still
  // reference its last action's output in detail.
  const lastToolIdx = turns.reduce((acc, t, i) => (t.role === 'tool_result' ? i : acc), -1);
  return turns.map((turn, index) => {
    if (turn.role !== 'tool_result') return turn;
    const limit = index === lastToolIdx ? maxTokens * 2 : maxTokens;
    return {
      ...turn,
      content: clip(turn.content.replace(/\s+/g, ' ').trim(), limit),
    };
  });
}

export function compressHistory(
  history: ConversationTurn[],
  config: HistoryCompressionConfig = DEFAULT_HISTORY_COMPRESSION,
): ConversationTurn[] {
  if (history.length === 0 || estimateTokens(history) <= config.maxHistoryTokens) {
    return history;
  }

  const recentTurnCount = Math.min(history.length, Math.max(config.keepRecentTurns * 2, config.keepRecentTurns));
  const splitIndex = Math.max(1, history.length - recentTurnCount);
  const olderTurns = history.slice(0, splitIndex);
  const recentTurns = truncateOlderToolResults(history.slice(splitIndex), config.toolResultMaxTokens);

  if (olderTurns.length === 0) {
    return recentTurns;
  }

  let summaryTurn = buildCompressedSummary(olderTurns, config);
  let retainedRecentTurns = recentTurns;
  let compressed = [summaryTurn, ...retainedRecentTurns];

  while (
    estimateTokens(compressed) > config.maxHistoryTokens &&
    retainedRecentTurns.length > Math.max(1, config.keepRecentTurns)
  ) {
    retainedRecentTurns = retainedRecentTurns.slice(1);
    compressed = [summaryTurn, ...retainedRecentTurns];
  }

  if (estimateTokens(compressed) <= config.maxHistoryTokens) {
    return sanitizeToolPairs(compressed);
  }

  summaryTurn = {
    ...summaryTurn,
    content: clip(summaryTurn.content, Math.max(240, config.maxHistoryTokens * 2)),
  };
  compressed = [summaryTurn, ...retainedRecentTurns];

  while (estimateTokens(compressed) > config.maxHistoryTokens && retainedRecentTurns.length > 1) {
    retainedRecentTurns = retainedRecentTurns.slice(1);
    compressed = [summaryTurn, ...retainedRecentTurns];
  }

  return sanitizeToolPairs(compressed);
}
