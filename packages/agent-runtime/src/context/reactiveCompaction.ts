/**
 * Reactive Compaction — Retry-With-Compression on Context Overflow
 *
 * Catches context-too-long errors from model APIs and retries the
 * model call with a tighter compression budget. Inspired by Claude
 * Code's reactiveCompact + truncateHeadForPTLRetry patterns.
 *
 * Error detection:
 *   - Gemini:    RESOURCE_EXHAUSTED, "token limit"
 *   - OpenAI:    "context_length_exceeded", "maximum context length"
 *   - Anthropic: "prompt is too long", "prompt_too_long"
 *
 * Circuit breaker: 3 consecutive reactive compactions in the same
 * run → stop retrying (the conversation is irrecoverably large).
 */

import type { ConversationTurn } from '../types.js';
import { composeModelContext } from './contextComposer.js';
import { microCompactHistory } from './microCompactor.js';
import type { ContextBudget } from './contextBudget.js';
import { calculateReactiveBudget } from './contextBudget.js';

// ═══════════════════════════════════════════════════════════════════
// ERROR DETECTION
// ═══════════════════════════════════════════════════════════════════

const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt.*(too long|too_long)/i,
  /context.*(length|limit).*exceeded/i,
  /maximum.*context.*length/i,
  /RESOURCE_EXHAUSTED/i,
  /token.*limit/i,
  /input.*too.*long/i,
  /request.*too.*large/i,
];

/**
 * Check if an error indicates the model's context window was exceeded.
 */
export function isContextOverflowError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) return false;
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(message));
}

function extractErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.error === 'object' && obj.error) {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.message === 'string') return inner.message;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// REACTIVE COMPACTION STATE
// ═══════════════════════════════════════════════════════════════════

export interface ReactiveCompactionState {
  /** Number of reactive compactions in the current run. */
  consecutiveCount: number;
  /** Maximum consecutive compactions before circuit-breaking. */
  maxRetries: number;
  /** Whether the circuit breaker has tripped. */
  circuitBroken: boolean;
  /** Last reactive budget used (for progressive tightening). */
  lastBudget: ContextBudget | null;
}

const DEFAULT_MAX_RETRIES = 3;

export function createReactiveState(maxRetries = DEFAULT_MAX_RETRIES): ReactiveCompactionState {
  return {
    consecutiveCount: 0,
    maxRetries,
    circuitBroken: false,
    lastBudget: null,
  };
}

/**
 * Record a reactive compaction attempt. Returns whether a retry is permitted.
 */
export function recordReactiveAttempt(state: ReactiveCompactionState): boolean {
  state.consecutiveCount++;
  if (state.consecutiveCount > state.maxRetries) {
    state.circuitBroken = true;
    return false;
  }
  return true;
}

/** Reset after a successful model call (no context overflow). */
export function resetReactiveState(state: ReactiveCompactionState): void {
  state.consecutiveCount = 0;
  state.circuitBroken = false;
  state.lastBudget = null;
}

// ═══════════════════════════════════════════════════════════════════
// REACTIVE RECOMPOSITION
// ═══════════════════════════════════════════════════════════════════

export interface ReactiveRecomposeInput {
  history: ConversationTurn[];
  role: string;
  task: string;
  initialMessage: string;
  turnNumber: number;
  normalBudget: ContextBudget;
  state: ReactiveCompactionState;
}

export interface ReactiveRecomposeResult {
  history: ConversationTurn[];
  tokenEstimate: number;
  budgetUsed: ContextBudget;
  dropped: number;
}

/**
 * Recompose history with a tighter budget after a context overflow error.
 * Each consecutive retry uses a progressively tighter budget.
 *
 * Returns null if the circuit breaker has tripped.
 */
export function reactiveRecompose(input: ReactiveRecomposeInput): ReactiveRecomposeResult | null {
  if (input.state.circuitBroken) return null;

  const canRetry = recordReactiveAttempt(input.state);
  if (!canRetry) {
    console.warn(
      `[ReactiveCompaction] Circuit breaker tripped for ${input.role}: ` +
      `${input.state.consecutiveCount} consecutive context overflows. ` +
      `Conversation is irrecoverably large.`,
    );
    return null;
  }

  // Progressive tightening: each retry gets 60% of the previous budget
  const baseBudget = input.state.lastBudget ?? input.normalBudget;
  const reactiveBudget = calculateReactiveBudget(baseBudget);
  input.state.lastBudget = reactiveBudget;

  console.warn(
    `[ReactiveCompaction] ${input.role} turn=${input.turnNumber}: ` +
    `Recomposing with tighter budget ` +
    `(${reactiveBudget.compositionBudget} tokens, attempt ${input.state.consecutiveCount}/${input.state.maxRetries})`,
  );

  // Micro-compact more aggressively: keep only 1 recent tool result, max 500 chars
  const microCompacted = microCompactHistory(input.history, {
    enabled: true,
    keepRecentToolResults: 1,
    maxToolResultChars: 500,
  });

  const composed = composeModelContext({
    history: microCompacted.history,
    role: input.role,
    task: input.task,
    initialMessage: input.initialMessage,
    turnNumber: input.turnNumber,
    maxTokens: reactiveBudget.compositionBudget,
    includeReasoningState: true,
    keepRecentGroups: 1, // Tighter: keep only last group
  });

  return {
    history: composed.history,
    tokenEstimate: composed.tokenEstimate,
    budgetUsed: reactiveBudget,
    dropped: composed.droppedTurns,
  };
}
