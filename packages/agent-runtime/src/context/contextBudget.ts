/**
 * Context Budget — Model-Aware Compaction Budgets
 *
 * Derives the compaction token budget from the model's context window,
 * replacing the hardcoded 12K constant. Inspired by Claude Code's
 * autoCompact threshold calculation:
 *
 *   effectiveWindow = contextWindow - min(maxOutputTokens, 20_000)
 *   autoCompactThreshold = effectiveWindow - BUFFER_TOKENS
 *
 * For Glyphor agents, we use a simpler model:
 *
 *   compositionBudget = min(contextWindow * budgetRatio, ABSOLUTE_MAX)
 *
 * This ensures agents with large windows (Gemini 1M) get generous budgets
 * while agents with small windows (128K models) stay conservative.
 *
 * The compaction pipeline (microCompactor → contextComposer → historyCompressor)
 * uses this budget instead of the old hardcoded CONTEXT_COMPOSITION_MAX_TOKENS.
 */

import { getContextWindow } from '@glyphor/shared';

// ═══════════════════════════════════════════════════════════════════
// BUDGET STRATEGY
// ═══════════════════════════════════════════════════════════════════

/** Fraction of context window allocated to composed history. */
const DEFAULT_BUDGET_RATIO = 0.06;

/** Absolute floor — never compress below this (tokens). */
const BUDGET_FLOOR = 8_000;

/** Absolute ceiling — never allocate more than this (tokens). */
const BUDGET_CEILING = 64_000;

/** Reserve for system prompt + tool declarations (tokens). */
const SYSTEM_PROMPT_RESERVE = 4_000;

/** Reserve for model output (tokens). */
const OUTPUT_RESERVE = 16_000;

export interface ContextBudget {
  /** The model's full context window (tokens). */
  contextWindow: number;
  /** Effective window after reserves (tokens). */
  effectiveWindow: number;
  /** Token budget for the composition pipeline (tokens). */
  compositionBudget: number;
  /** Warning threshold — log when composed context exceeds this. */
  warningThreshold: number;
  /** Hard limit — force aggressive compaction above this. */
  hardLimit: number;
}

/**
 * Calculate the context budget for a given model.
 *
 * @param modelId - Model identifier from the registry
 * @param budgetRatio - Optional override for the budget ratio (default: 0.06)
 */
export function calculateContextBudget(
  modelId: string,
  budgetRatio = DEFAULT_BUDGET_RATIO,
): ContextBudget {
  const contextWindow = getContextWindow(modelId);
  const effectiveWindow = contextWindow - SYSTEM_PROMPT_RESERVE - OUTPUT_RESERVE;

  // Scale budget with window size, clamped to floor/ceiling
  const rawBudget = Math.round(effectiveWindow * budgetRatio);
  const compositionBudget = Math.max(BUDGET_FLOOR, Math.min(rawBudget, BUDGET_CEILING));

  return {
    contextWindow,
    effectiveWindow: Math.max(0, effectiveWindow),
    compositionBudget,
    warningThreshold: Math.round(compositionBudget * 0.85),
    hardLimit: Math.round(compositionBudget * 1.3),
  };
}

/**
 * Calculate a tighter budget for reactive compaction (after a
 * context-too-long error). Uses 60% of the normal budget.
 */
export function calculateReactiveBudget(normalBudget: ContextBudget): ContextBudget {
  const tighterBudget = Math.max(BUDGET_FLOOR, Math.round(normalBudget.compositionBudget * 0.6));
  return {
    ...normalBudget,
    compositionBudget: tighterBudget,
    warningThreshold: Math.round(tighterBudget * 0.85),
    hardLimit: Math.round(tighterBudget * 1.3),
  };
}
