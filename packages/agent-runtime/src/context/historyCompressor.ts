import type { ConversationTurn } from '../types.js';
import { groupConversation, type ConversationGroup } from '../historyManager.js';
import {
  REASONING_STATE_PREFIX,
  SYSTEM_FRAME_PREFIX,
} from './systemFrame.js';

export interface ContextCompressionOptions {
  maxTokens: number;
  taskMessage?: string;
  keepRecentGroups?: number;
}

export interface ContextCompressionResult {
  history: ConversationTurn[];
  tokenEstimate: number;
  droppedTurns: number;
  droppedGroups: number;
  clippedTurns: number;
}

interface ScoredGroup {
  group: ConversationGroup;
  index: number;
  tokens: number;
  trimBand: number;
  priorityScore: number;
  neverTrim: boolean;
}

const IDENTITY_HINTS = [
  '## WHO YOU ARE',
  '## YOUR SKILLS',
  '## Canonical Company Doctrine',
  '## Your Assignment',
];

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function estimateTokens(turns: ConversationTurn[]): number {
  return Math.ceil(turns.reduce((sum, turn) => sum + (turn.content ?? '').length, 0) / 4);
}

function isIdentityAnchor(turn: ConversationTurn): boolean {
  if (turn.role !== 'user') return false;
  const content = turn.content ?? '';
  if (!content.startsWith('[CONTEXT')) return false;
  return IDENTITY_HINTS.some((hint) => content.includes(hint));
}

function isFrameTurn(turn: ConversationTurn): boolean {
  return turn.role === 'user' && (turn.content ?? '').startsWith(SYSTEM_FRAME_PREFIX);
}

function isReasoningStateTurn(turn: ConversationTurn): boolean {
  return turn.role === 'user' && (turn.content ?? '').startsWith(REASONING_STATE_PREFIX);
}

function isTaskAnchorTurn(turn: ConversationTurn, taskMessage?: string): boolean {
  if (turn.role !== 'user' || !taskMessage) return false;
  return (turn.content ?? '').trim() === taskMessage.trim();
}

function resolveMaxLength(turn: ConversationTurn, index: number, total: number): number {
  const age = total - index - 1;
  if (isFrameTurn(turn)) return 1800;
  if (isReasoningStateTurn(turn)) return 1400;
  if (isIdentityAnchor(turn)) return 1800;

  if (turn.role === 'user') return age <= 2 ? 2400 : 1200;
  if (turn.role === 'assistant') return age <= 2 ? 2200 : 1000;
  if (turn.role === 'tool_result') return age <= 1 ? 1800 : 700;
  return 450; // tool_call
}

function asymmetricallyClip(history: ConversationTurn[]): { history: ConversationTurn[]; clippedTurns: number } {
  let clippedTurns = 0;
  const clipped = history.map((turn, index) => {
    const maxLength = resolveMaxLength(turn, index, history.length);
    const trimmed = clip((turn.content ?? '').replace(/\s+/g, ' ').trim(), maxLength);
    if (trimmed !== turn.content) clippedTurns += 1;
    return {
      ...turn,
      content: trimmed,
    };
  });

  return { history: clipped, clippedTurns };
}

function detectTaskAnchorIndex(history: ConversationTurn[], taskMessage?: string): number {
  if (!taskMessage) return -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isTaskAnchorTurn(history[i], taskMessage)) return i;
  }
  return -1;
}

function scoreGroups(
  groups: ConversationGroup[],
  history: ConversationTurn[],
  taskMessage?: string,
  keepRecentGroups = 2,
): ScoredGroup[] {
  const taskAnchorIndex = detectTaskAnchorIndex(history, taskMessage);
  const recentFloor = Math.max(0, groups.length - Math.max(1, keepRecentGroups));

  return groups.map((group, index) => {
    const recency = groups.length <= 1 ? 1 : index / (groups.length - 1);
    const hasFrame = group.turns.some((turn) => isFrameTurn(turn));
    const hasIdentity = group.turns.some((turn) => isIdentityAnchor(turn));
    const hasTaskAnchor = taskAnchorIndex >= 0 && group.turns.some((turn) => history[taskAnchorIndex] === turn);
    const hasReasoningState = group.turns.some((turn) => isReasoningStateTurn(turn));
    const hasFailedTool = group.turns.some((turn) => turn.role === 'tool_result' && !!turn.toolResult && !turn.toolResult.success);

    const neverTrim = hasFrame || hasIdentity || hasTaskAnchor;

    let trimBand = 4;
    if (group.type === 'system') trimBand = 0;
    else if (group.type === 'reflection') trimBand = 1;
    else if (group.type === 'tool_group') trimBand = 2;
    else if (group.type === 'user_exchange') trimBand = 3;

    if (index >= recentFloor) {
      trimBand += 2;
    }

    let priorityScore = recency * 100;
    if (group.type === 'user_exchange') priorityScore += 30;
    if (group.type === 'tool_group') priorityScore += 20;
    if (group.type === 'reflection') priorityScore += 5;
    if (hasReasoningState) priorityScore += 45;
    if (hasFailedTool) priorityScore -= 15;

    if (neverTrim) {
      trimBand = Number.MAX_SAFE_INTEGER;
      priorityScore = Number.MAX_SAFE_INTEGER;
    }

    return {
      group,
      index,
      tokens: estimateTokens(group.turns),
      trimBand,
      priorityScore,
      neverTrim,
    };
  });
}

function aggressivelyCompact(turn: ConversationTurn): ConversationTurn {
  let maxLength = 700;
  if (isFrameTurn(turn)) maxLength = 1400;
  else if (isIdentityAnchor(turn)) maxLength = 1000;
  else if (isReasoningStateTurn(turn)) maxLength = 900;
  else if (turn.role === 'user') maxLength = 950;
  else if (turn.role === 'assistant') maxLength = 850;
  else if (turn.role === 'tool_result') maxLength = 650;
  else maxLength = 300;

  return {
    ...turn,
    content: clip((turn.content ?? '').replace(/\s+/g, ' ').trim(), maxLength),
  };
}

export function compressComposedHistory(
  history: ConversationTurn[],
  options: ContextCompressionOptions,
): ContextCompressionResult {
  if (history.length === 0) {
    return {
      history,
      tokenEstimate: 0,
      droppedTurns: 0,
      droppedGroups: 0,
      clippedTurns: 0,
    };
  }

  const keepRecentGroups = options.keepRecentGroups ?? 2;
  const clipped = asymmetricallyClip(history);
  let workingHistory = clipped.history;
  let tokenEstimate = estimateTokens(workingHistory);

  if (tokenEstimate <= options.maxTokens) {
    return {
      history: workingHistory,
      tokenEstimate,
      droppedTurns: 0,
      droppedGroups: 0,
      clippedTurns: clipped.clippedTurns,
    };
  }

  const groups = groupConversation(workingHistory);
  const scored = scoreGroups(groups, workingHistory, options.taskMessage, keepRecentGroups);
  const removable = scored
    .filter((item) => !item.neverTrim)
    .sort((left, right) => {
      if (left.trimBand !== right.trimBand) return left.trimBand - right.trimBand;
      if (left.priorityScore !== right.priorityScore) return left.priorityScore - right.priorityScore;
      return left.index - right.index;
    });

  const dropGroupIndexes = new Set<number>();
  let currentTokens = scored.reduce((sum, item) => sum + item.tokens, 0);
  for (const candidate of removable) {
    if (currentTokens <= options.maxTokens) break;
    dropGroupIndexes.add(candidate.index);
    currentTokens -= candidate.tokens;
  }

  const survivingGroups = scored
    .filter((item) => !dropGroupIndexes.has(item.index))
    .sort((left, right) => left.index - right.index);
  workingHistory = survivingGroups.flatMap((item) => item.group.turns);
  tokenEstimate = estimateTokens(workingHistory);

  if (tokenEstimate > options.maxTokens) {
    workingHistory = workingHistory.map((turn) => aggressivelyCompact(turn));
    tokenEstimate = estimateTokens(workingHistory);
  }

  return {
    history: workingHistory,
    tokenEstimate,
    droppedTurns: Math.max(0, history.length - workingHistory.length),
    droppedGroups: dropGroupIndexes.size,
    clippedTurns: clipped.clippedTurns,
  };
}
