import type { ConversationTurn } from '../types.js';

export interface MicroCompactionOptions {
  enabled?: boolean;
  keepRecentToolResults?: number;
  maxToolResultChars?: number;
  /**
   * When true (default), automatically adjusts keepRecentToolResults and
   * maxToolResultChars based on the density of tool_result turns in the
   * conversation. High-tool-count runs keep more recent results but with
   * tighter per-result budgets; low-tool-count runs keep fewer but larger.
   */
  adaptive?: boolean;
}

export interface MicroCompactionResult {
  history: ConversationTurn[];
  compactedTurns: number;
  summary?: string;
}

const DEFAULT_KEEP_RECENT_RESULTS = 3;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 900;

/**
 * Compute adaptive compaction limits based on tool_result density.
 *
 * Strategy (inspired by Claude Code's dynamic context budgeting):
 *   - Low density  (≤5 results):  keep 2 recent, generous 1500 chars each
 *   - Medium density (6-12):      keep 3 recent, standard 900 chars each
 *   - High density   (13-20):     keep 4 recent, tighter 600 chars each
 *   - Very high      (>20):       keep 5 recent, minimum 400 chars each
 *
 * The goal: preserve as much useful context as possible while staying
 * within the composition budget. High-tool runs need more breadth;
 * low-tool runs benefit from depth.
 */
function computeAdaptiveLimits(toolResultCount: number): {
  keepRecent: number;
  maxChars: number;
} {
  if (toolResultCount <= 5) {
    return { keepRecent: 2, maxChars: 1500 };
  }
  if (toolResultCount <= 12) {
    return { keepRecent: 3, maxChars: 900 };
  }
  if (toolResultCount <= 20) {
    return { keepRecent: 4, maxChars: 600 };
  }
  return { keepRecent: 5, maxChars: 400 };
}

export function microCompactHistory(
  history: ConversationTurn[],
  options: MicroCompactionOptions = {},
): MicroCompactionResult {
  const enabled = options.enabled ?? true;
  if (!enabled || history.length === 0) {
    return { history, compactedTurns: 0 };
  }

  const toolResultIndexes: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === 'tool_result') {
      toolResultIndexes.push(i);
    }
  }

  // Compute effective limits: use adaptive when enabled and no explicit overrides
  const useAdaptive = (options.adaptive ?? true)
    && options.keepRecentToolResults === undefined
    && options.maxToolResultChars === undefined;

  let keepRecentToolResults: number;
  let maxToolResultChars: number;

  if (useAdaptive) {
    const adaptive = computeAdaptiveLimits(toolResultIndexes.length);
    keepRecentToolResults = adaptive.keepRecent;
    maxToolResultChars = adaptive.maxChars;
  } else {
    keepRecentToolResults = Math.max(0, options.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_RESULTS);
    maxToolResultChars = Math.max(120, options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS);
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
