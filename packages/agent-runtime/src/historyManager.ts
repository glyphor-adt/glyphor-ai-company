import type { ConversationTurn } from './types.js';

export interface HistoryCompressionConfig {
  maxHistoryTokens: number;
  keepRecentTurns: number;
  toolResultMaxTokens: number;
  summarizeToolResults: boolean;
}

export const DEFAULT_HISTORY_COMPRESSION: HistoryCompressionConfig = {
  maxHistoryTokens: 15_000,
  keepRecentTurns: 3,
  toolResultMaxTokens: 500,
  summarizeToolResults: true,
};

function estimateTokens(history: ConversationTurn[]): number {
  return Math.ceil(history.reduce((total, turn) => total + turn.content.length, 0) / 4);
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

function truncateOlderToolResults(
  turns: ConversationTurn[],
  maxTokens: number,
): ConversationTurn[] {
  return turns.map((turn, index) => {
    if (turn.role !== 'tool_result') return turn;
    const isRecentTail = index >= turns.length - 4;
    if (isRecentTail) return turn;
    return {
      ...turn,
      content: clip(turn.content.replace(/\s+/g, ' ').trim(), maxTokens),
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
    return compressed;
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

  return compressed;
}
