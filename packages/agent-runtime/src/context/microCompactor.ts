import type { ConversationTurn } from '../types.js';

export interface MicroCompactionOptions {
  enabled?: boolean;
  keepRecentToolResults?: number;
  maxToolResultChars?: number;
}

export interface MicroCompactionResult {
  history: ConversationTurn[];
  compactedTurns: number;
  summary?: string;
}

const DEFAULT_KEEP_RECENT_RESULTS = 3;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 900;

export function microCompactHistory(
  history: ConversationTurn[],
  options: MicroCompactionOptions = {},
): MicroCompactionResult {
  const enabled = options.enabled ?? true;
  if (!enabled || history.length === 0) {
    return { history, compactedTurns: 0 };
  }

  const keepRecentToolResults = Math.max(0, options.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_RESULTS);
  const maxToolResultChars = Math.max(120, options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS);

  const toolResultIndexes: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'tool_result') {
      toolResultIndexes.push(i);
    }
  }

  if (toolResultIndexes.length <= keepRecentToolResults) {
    return { history, compactedTurns: 0 };
  }

  const protectedIndexes = new Set(toolResultIndexes.slice(-keepRecentToolResults));
  let compactedTurns = 0;

  const compactedHistory = history.map((turn, idx) => {
    if (turn.role !== 'tool_result') return turn;
    if (protectedIndexes.has(idx)) return turn;
    if (turn.toolResult && !turn.toolResult.success) return turn;

    const normalizedContent = (turn.content ?? '').replace(/\s+/g, ' ').trim();
    if (normalizedContent.length <= maxToolResultChars) return turn;

    compactedTurns += 1;
    const toolLabel = turn.toolName ?? 'tool';
    const clipped = `${normalizedContent.slice(0, maxToolResultChars)}...`;
    return {
      ...turn,
      content: `[MICRO-COMPACTED tool_result:${toolLabel}] ${clipped}`,
    };
  });

  return {
    history: compactedHistory,
    compactedTurns,
    ...(compactedTurns > 0
      ? { summary: `Micro-compacted ${compactedTurns} older tool_result turn(s)` }
      : {}),
  };
}
