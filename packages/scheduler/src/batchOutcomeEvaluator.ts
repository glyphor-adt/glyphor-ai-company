/**
 * Batch Outcome Evaluator — Scheduled quality scoring for task run outcomes
 *
 * Runs twice daily (2 AM / 2 PM UTC) to evaluate unevaluated task outcomes
 * using a purely algorithmic quality score (no LLM). Each outcome receives a
 * batch_quality_score between 1.0 and 5.0 based on deterministic and
 * downstream signals captured in the task_run_outcomes table.
 */

import { getGoogleAiApiKey } from '@glyphor/shared';


import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache, TrustScorer } from '@glyphor/agent-runtime';
import { incrementDownstreamDefects } from '@glyphor/agent-runtime';
import { reflect, applyMutation, queueShadowEvaluation, writeWorldModelCorrection } from '@glyphor/agent-runtime';
import { WorldModelUpdater, SharedMemoryLoader, EmbeddingClient } from '@glyphor/company-memory';
import { evaluateToolAccuracy } from './toolAccuracyEvaluator.js';
import { evaluateUnevaluatedHandoffs } from './handoffQualityEvaluator.js';

// ─── Types ──────────────────────────────────────────────────────

export interface BatchEvalResult {
  evaluated: number;
  updated: number;
}

interface TaskRunOutcome {
  id: string;
  run_id: string | null;
  assignment_id: string | null;
  agent_role: string;
  final_status: string;
  turn_count: number;
  tool_failure_count: number;
  had_partial_save: boolean;
  cost_usd: number;
  was_revised: boolean | null;
  revision_count: number | null;
  was_accepted: boolean | null;
  downstream_agent_succeeded: boolean | null;
  per_run_quality_score: number | null;
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
      `SELECT id, run_id, assignment_id, agent_role, final_status, turn_count, tool_failure_count, had_partial_save,
              cost_usd, was_revised, revision_count, was_accepted,
              downstream_agent_succeeded, per_run_quality_score
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

    // Refresh delegation performance materialized view
    try {
      await systemQuery('SELECT refresh_delegation_metrics()');
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] Failed to refresh delegation metrics:', (err as Error).message);
    }

    // Track downstream defects in tool_reputation for revised outcomes
    try {
      const revisedOutcomes = outcomes.filter(o => o.was_revised === true);
      if (revisedOutcomes.length > 0) {
        const revisedIds = revisedOutcomes.map(o => o.id);
        const toolCallRows = await systemQuery<{ tool_name: string }>(
          `SELECT DISTINCT unnest(tool_names_used) AS tool_name
           FROM task_run_outcomes
           WHERE id = ANY($1::uuid[]) AND tool_names_used IS NOT NULL`,
          [revisedIds],
        );
        const toolNames = toolCallRows.map(r => r.tool_name);
        if (toolNames.length > 0) {
          await incrementDownstreamDefects(toolNames);
          console.log(`[BatchOutcomeEvaluator] Incremented downstream defects for ${toolNames.length} tools from ${revisedIds.length} revised runs`);
        }
      }
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] Downstream defect tracking failed:', (err as Error).message);
    }

    // ─── Tool accuracy evaluation (fire-and-forget) ─────────────
    // For each outcome with a linked assignment, score tool selection quality.
    try {
      const eligibleOutcomes = outcomes.filter(o => o.run_id && o.assignment_id);
      if (eligibleOutcomes.length > 0) {
        const assignmentIds = eligibleOutcomes.map(o => o.assignment_id!);
        const taskDescriptions = await systemQuery<{ id: string; task_description: string }>(
          `SELECT id, task_description FROM work_assignments WHERE id = ANY($1::uuid[])`,
          [assignmentIds],
        );
        const taskMap = new Map(taskDescriptions.map(t => [t.id, t.task_description]));

        let toolAccuracyCount = 0;
        for (const outcome of eligibleOutcomes) {
          const taskDesc = taskMap.get(outcome.assignment_id!);
          if (!taskDesc) continue;
          void evaluateToolAccuracy(
            outcome.run_id!,
            outcome.assignment_id!,
            outcome.id,
            taskDesc,
            outcome.agent_role,
          ).catch(err => console.warn('[BatchOutcomeEvaluator] Tool accuracy eval failed:', (err as Error).message));
          toolAccuracyCount++;
        }
        if (toolAccuracyCount > 0) {
          console.log(`[BatchOutcomeEvaluator] Queued ${toolAccuracyCount} tool accuracy evaluations`);
        }
      }
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] Tool accuracy trigger failed:', (err as Error).message);
    }

    // Update world models and trust scores for each agent that had outcomes evaluated
    try {
      const agentRoles = [...new Set(outcomes.map(o => o.agent_role))];
      const embeddingClient = new EmbeddingClient(getGoogleAiApiKey()!);
      const sharedMemory = new SharedMemoryLoader(embeddingClient, null, cache);
      const worldModelUpdater = new WorldModelUpdater(sharedMemory);
      const trustScorer = new TrustScorer(cache);

      for (const role of agentRoles) {
        try {
          const aggregates = await worldModelUpdater.updateFromBatchOutcomes(role as any);
          if (aggregates) {
            await trustScorer.applyBatchOutcomeDelta(role, aggregates.avgBatchQualityScore);
          }
        } catch (err) {
          console.warn('[BatchOutcomeEvaluator] World model update failed for', role, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] World model batch update failed:', (err as Error).message);
    }

    // ─── Reflection trigger: queue prompt mutations for low-scoring agents ────
    try {
      const lowScoreAgents = await systemQuery<{ role: string; performance_score: number }>(
        `SELECT role, performance_score FROM company_agents
         WHERE role = ANY($1) AND performance_score IS NOT NULL AND performance_score < 0.65`,
        [[...new Set(outcomes.map(o => o.agent_role))]],
      );

      for (const agent of lowScoreAgents) {
        // Find the most recent run for this agent in this batch
        const recentRun = await systemQuery<{ run_id: string }>(
          `SELECT tro.run_id FROM task_run_outcomes tro
           WHERE tro.agent_role = $1 AND tro.run_id IS NOT NULL
           ORDER BY tro.created_at DESC LIMIT 1`,
          [agent.role],
        );
        if (!recentRun[0]?.run_id) continue;

        // Fire-and-forget: reflect → mutate → queue shadow
        reflect(agent.role, recentRun[0].run_id)
          .then(async (reflection) => {
            if (!reflection) return;
            // Write world model correction if persistent weakness detected
            void writeWorldModelCorrection(
              agent.role,
              recentRun[0].run_id,
              reflection,
              agent.performance_score,
            ).catch(() => {});
            const newVersion = await applyMutation(agent.role, reflection);
            if (newVersion) {
              await queueShadowEvaluation(agent.role, newVersion);
              console.log(`[BatchOutcomeEvaluator] Reflection queued shadow eval for ${agent.role} v${newVersion}`);
            }
          })
          .catch((err) => {
            console.warn(`[BatchOutcomeEvaluator] Reflection failed for ${agent.role}:`, (err as Error).message);
          });
      }
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] Reflection trigger failed:', (err as Error).message);
    }

    // ─── Handoff quality evaluation: score unevaluated inter-agent handoffs ────
    try {
      const handoffCount = await evaluateUnevaluatedHandoffs(50);
      if (handoffCount > 0) {
        console.log(`[BatchOutcomeEvaluator] Evaluated ${handoffCount} handoff traces`);
      }
    } catch (err) {
      console.warn('[BatchOutcomeEvaluator] Handoff evaluation failed:', (err as Error).message);
    }
  } finally {
    await cache.del(LOCK_KEY);
  }

  return result;
}

// ─── Scoring Logic ──────────────────────────────────────────────

function computeQualityScore(o: TaskRunOutcome): { score: number; notes: string } {
  // Use per_run_quality_score as baseline when present; it already accounts for
  // deterministic signals (final_status, tool_failures, turn_count, cost).
  // Fall back to 3.0 for older rows that predate per-run scoring.
  let score = o.per_run_quality_score != null ? Number(o.per_run_quality_score) : 3.0;
  const signals: string[] = o.per_run_quality_score != null
    ? [`baseline=${o.per_run_quality_score} (per-run)`]
    : [];

  if (o.per_run_quality_score == null) {
    // Legacy path: deterministic signals not yet pre-computed, apply them now.
    if (o.tool_failure_count === 0) {
      score += 0.2;
      signals.push('+0.2 no tool failures');
    }

    if (o.final_status === 'aborted' || o.final_status === 'failed') {
      score -= 1.0;
      signals.push('-1.0 ' + o.final_status);
    }

    if (o.final_status === 'flagged_blocker') {
      score -= 0.5;
      signals.push('-0.5 flagged_blocker');
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
  }

  // Delayed signals — only available after downstream processing; always applied.
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

  if (o.turn_count <= 5 && o.was_accepted === true) {
    score += 0.2;
    signals.push('+0.2 efficient + accepted');
  }

  if (o.was_revised === true && o.was_accepted == null) {
    score -= 0.5;
    signals.push('-0.5 revised but not accepted');
  }

  // Clamp to [1.0, 5.0]
  score = Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));

  return { score, notes: signals.join('; ') };
}
