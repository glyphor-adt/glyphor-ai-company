import type { ConversationTurn } from '../types.js';
import { extractReasoning, stripReasoning } from '../reasoning.js';
import { compressComposedHistory } from './historyCompressor.js';
import {
  buildSystemFrameTurn,
  isSyntheticContextTurn,
  REASONING_STATE_PREFIX,
  SESSION_SUMMARY_PREFIX,
} from './systemFrame.js';

export interface ContextComposerInput {
  history: ConversationTurn[];
  role: string;
  task: string;
  initialMessage: string;
  turnNumber: number;
  bundleKind?: 'planning' | 'execution' | 'verification';
  maxTokens?: number;
  includeReasoningState?: boolean;
  keepRecentGroups?: number;
  sessionSummary?: string;
}

export interface ContextComposerResult {
  history: ConversationTurn[];
  tokenEstimate: number;
  droppedTurns: number;
  droppedGroups: number;
  clippedTurns: number;
  injectedReasoningState: boolean;
}

const DEFAULT_MAX_TOKENS = 12_000;

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildReasoningStateTurn(history: ConversationTurn[]): ConversationTurn | null {
  const lines: string[] = [];
  const assistantTurns = history.filter((turn) => turn.role === 'assistant').slice(-4).reverse();

  let captured = 0;
  for (const turn of assistantTurns) {
    const envelope = extractReasoning(turn.content ?? '');
    if (!envelope) continue;

    captured += 1;
    lines.push(`Reasoning snapshot ${captured}:`);
    if (envelope.approach) lines.push(`- Approach: ${clip(envelope.approach.replace(/\s+/g, ' ').trim(), 260)}`);
    if (envelope.tradeoffs) lines.push(`- Tradeoffs: ${clip(envelope.tradeoffs.replace(/\s+/g, ' ').trim(), 220)}`);
    if (envelope.risks) lines.push(`- Risks: ${clip(envelope.risks.replace(/\s+/g, ' ').trim(), 220)}`);
    if (envelope.alternatives) lines.push(`- Alternatives: ${clip(envelope.alternatives.replace(/\s+/g, ' ').trim(), 220)}`);

    const assistantText = stripReasoning(turn.content ?? '').replace(/\s+/g, ' ').trim();
    if (assistantText) {
      lines.push(`- Last visible output: ${clip(assistantText, 220)}`);
    }

    if (captured >= 2) break;
    lines.push('');
  }

  const recentFailures = history
    .filter((turn) => turn.role === 'tool_result' && turn.toolResult && !turn.toolResult.success)
    .slice(-2);
  if (recentFailures.length > 0) {
    lines.push('Recent tool failures:');
    for (const failure of recentFailures) {
      const detail = failure.toolResult?.error ?? failure.content ?? 'Unknown tool failure';
      lines.push(`- ${failure.toolName ?? 'tool'}: ${clip(detail.replace(/\s+/g, ' ').trim(), 200)}`);
    }
  }

  if (lines.length === 0) return null;

  return {
    role: 'user',
    content: `${REASONING_STATE_PREFIX}\nUse this as continuity only. Do not answer this message directly.\n\n${lines.join('\n')}`,
    timestamp: Date.now(),
  };
}

function buildSessionSummaryTurn(sessionSummary?: string): ConversationTurn | null {
  const normalized = (sessionSummary ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return {
    role: 'user',
    content: `${SESSION_SUMMARY_PREFIX}\nUse this summary for continuity. Prioritize this over stale tool chatter.\n\n${clip(normalized, 4800)}`,
    timestamp: Date.now(),
  };
}

export function composeModelContext(input: ContextComposerInput): ContextComposerResult {
  const sanitizedHistory = input.history.filter((turn) => !isSyntheticContextTurn(turn));
  const frameTurn = buildSystemFrameTurn({
    role: input.role,
    task: input.task,
    initialMessage: input.initialMessage,
    turnNumber: input.turnNumber,
    bundleKind: input.bundleKind,
  });

  const reasoningStateTurn = input.includeReasoningState === false
    ? null
    : buildReasoningStateTurn(sanitizedHistory);
  const sessionSummaryTurn = buildSessionSummaryTurn(input.sessionSummary);

  const composedHistory: ConversationTurn[] = [
    frameTurn,
    ...(sessionSummaryTurn ? [sessionSummaryTurn] : []),
    ...(reasoningStateTurn ? [reasoningStateTurn] : []),
    ...sanitizedHistory,
  ];

  const compressed = compressComposedHistory(composedHistory, {
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    taskMessage: input.initialMessage,
    keepRecentGroups: input.keepRecentGroups ?? 2,
  });

  return {
    ...compressed,
    injectedReasoningState: !!reasoningStateTurn,
  };
}
