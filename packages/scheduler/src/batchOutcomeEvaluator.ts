/**
 * Batch Outcome Evaluator — Scheduled quality scoring for task run outcomes
 *
 * Runs twice daily (2 AM / 2 PM UTC) to evaluate unevaluated task outcomes
 * using a purely algorithmic quality score (no LLM). Each outcome receives a
 * batch_quality_score between 1.0 and 5.0 based on deterministic and
 * downstream signals captured in the task_run_outcomes table.
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface BatchEvalResult {
  evaluated: number;
  updated: number;
}

interface TaskRunOutcome {
  id: string;
  final_status: string;
  turn_count: number;
  tool_failure_count: number;
  had_partial_save: boolean;
  cost_usd: number;
  was_revised: boolean | null;
  revision_count: number | null;
  was_accepted: boolean | null;
  downstream_agent_succeeded: boolean | null;
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'batch-outcome-eval-lock';
const LOCK_TTL_SECONDS = 30 * 60; // 30 minutes
const BATCH_LIMIT = 200;
const COOLDOWN_HOURS = 2;

// ─── Main Entry Point ───────────────────────────────────────────

export async function evaluateBatch(): Promise<BatchEvalResult> {
  const result: BatchEvalResult = { evaluated: 0, updated: 0 };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log('[BatchOutcomeEvaluator] Skipping — another evaluation is in progress');
    return result;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // Fetch unevaluated outcomes older than the cooldown window
    const outcomes = await systemQuery<TaskRunOutcome>(
      `SELECT id, final_status, turn_count, tool_failure_count, had_partial_save,
              cost_usd, was_revised, revision_count, was_accepted,
              downstream_agent_succeeded
       FROM task_run_outcomes
       WHERE batch_evaluated_at IS NULL
         AND created_at < NOW() - INTERVAL '${COOLDOWN_HOURS} hours'
       LIMIT $1`,
      [BATCH_LIMIT],
    );

    result.evaluated = outcomes.length;

    if (outcomes.length === 0) {
      console.log('[BatchOutcomeEvaluator] No unevaluated outcomes found');
      return result;
    }

    // Score and update each outcome
    for (const outcome of outcomes) {
      const { score, notes } = computeQualityScore(outcome);

      try {
        await systemQuery(
          `UPDATE task_run_outcomes
           SET batch_quality_score = $1, batch_evaluated_at = NOW(), evaluation_notes = $2
           WHERE id = $3`,
          [score, notes, outcome.id],
        );
        result.updated++;
      } catch (err) {
        console.warn('[BatchOutcomeEvaluator] Update failed for', outcome.id, (err as Error).message);
      }
    }

    console.log('[BatchOutcomeEvaluator] Complete:', JSON.stringify(result));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return result;
}

// ─── Scoring Logic ──────────────────────────────────────────────

function computeQualityScore(o: TaskRunOutcome): { score: number; notes: string } {
  let score = 3.0;
  const signals: string[] = [];

  // Positive signals
  if (o.was_accepted === true && (o.revision_count ?? 0) === 0) {
    score += 1.0;
    signals.push('+1.0 first-time accept');
  } else if (o.was_accepted === true && (o.revision_count ?? 0) > 0) {
    score += 0.5;
    signals.push('+0.5 accepted after revision');
  }

  if (o.downstream_agent_succeeded === true) {
    score += 0.3;
    signals.push('+0.3 downstream succeeded');
  }

  if (o.tool_failure_count === 0) {
    score += 0.2;
    signals.push('+0.2 no tool failures');
  }

  if (o.turn_count <= 5 && o.was_accepted === true) {
    score += 0.2;
    signals.push('+0.2 efficient + accepted');
  }

  // Negative signals
  if (o.final_status === 'aborted' || o.final_status === 'failed') {
    score -= 1.0;
    signals.push('-1.0 ' + o.final_status);
  }

  if (o.final_status === 'flagged_blocker') {
    score -= 0.5;
    signals.push('-0.5 flagged_blocker');
  }

  if (o.was_revised === true && o.was_accepted == null) {
    score -= 0.5;
    signals.push('-0.5 revised but not accepted');
  }

  if (o.tool_failure_count > 3) {
    score -= 0.3;
    signals.push('-0.3 high tool failures');
  }

  if (o.had_partial_save === true) {
    score -= 0.2;
    signals.push('-0.2 partial save');
  }

  if (o.turn_count > 15) {
    score -= 0.2;
    signals.push('-0.2 high turn count');
  }

  if (Number(o.cost_usd) > 0.50) {
    score -= 0.1;
    signals.push('-0.1 high cost');
  }

  // Clamp to [1.0, 5.0]
  score = Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));

  return { score, notes: signals.join('; ') };
}
