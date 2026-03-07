/**
 * Policy Canary Manager — Canary rollout of candidate policies with auto-revert
 *
 * Runs every 4 hours (0 *​/4 * * *) to manage the canary lifecycle for
 * policy_versions that have passed replay evaluation.
 *
 * Three Phases:
 *  1. Promote candidates → canary (apply policy change, snapshot previous value)
 *  2. Check active canaries (compare quality against baseline, promote or revert)
 *  3. Notify (log state changes to activity_log, emit events)
 *
 * Policy Types and Application:
 *  - prompt          → update agent_briefs.system_prompt
 *  - routing         → log routing override (application-level config)
 *  - model_selection → update company_agents.model
 *  - constitution    → update agent_constitutions
 *  - rubric          → update role_rubrics
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache, GlyphorEventBus } from '@glyphor/agent-runtime';
import type { GlyphorEventType } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface CanaryReport {
  promoted_to_canary: number;
  promoted_to_active: number;
  rolled_back: number;
  insufficient_data: number;
}

interface CandidatePolicy {
  id: string;
  policy_type: string;
  agent_role: string | null;
  content: Record<string, unknown>;
  eval_score: number;
  created_at: string;
}

interface CanaryPolicy {
  id: string;
  policy_type: string;
  agent_role: string | null;
  content: Record<string, unknown>;
  eval_details: Record<string, unknown>;
  promoted_at: string;
}

interface PolicySnapshot {
  previous_value: unknown;
  snapshot_at: string;
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'policy-canary-check-lock';
const LOCK_TTL_SECONDS = 15 * 60; // 15 minutes
const LOG_PREFIX = '[PolicyCanaryManager]';

const MAX_CONCURRENT_CANARIES = 3;
const CANDIDATE_MIN_AGE_HOURS = 24;
const CANDIDATE_BATCH_LIMIT = 3;
const CANDIDATE_MIN_SCORE = 0.6;

const CANARY_MIN_RUNS = 10;
const CANARY_PROMOTE_RUNS = 20;
const CANARY_PROMOTE_TOLERANCE = 0.3;  // canary avg >= baseline - tolerance → promote
const CANARY_REVERT_THRESHOLD = 0.5;   // canary avg < baseline - threshold → revert
const CANARY_MAX_AGE_DAYS = 7;
const BASELINE_LOOKBACK_DAYS = 30;

// ─── Main Entry Point ───────────────────────────────────────────

export async function manageCanaries(eventBus?: GlyphorEventBus): Promise<CanaryReport> {
  const report: CanaryReport = {
    promoted_to_canary: 0,
    promoted_to_active: 0,
    rolled_back: 0,
    insufficient_data: 0,
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log(`${LOG_PREFIX} Skipping — another canary check is in progress`);
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // Phase 1: Promote candidates → canary
    await promoteCandidates(report);

    // Phase 2: Check active canaries
    await checkCanaries(report, eventBus);

    console.log(`${LOG_PREFIX} Complete:`, JSON.stringify(report));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Phase 1: Promote Candidates to Canary ──────────────────────

async function promoteCandidates(report: CanaryReport): Promise<void> {
  // Check how many canaries are already active
  const activeCanaries = await systemQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM policy_versions WHERE status = 'canary'`,
    [],
  );
  const currentCount = activeCanaries[0]?.count ?? 0;
  if (currentCount >= MAX_CONCURRENT_CANARIES) {
    console.log(`${LOG_PREFIX} Phase 1: ${currentCount} canaries active (max ${MAX_CONCURRENT_CANARIES}) — skipping promotion`);
    return;
  }

  const slotsAvailable = MAX_CONCURRENT_CANARIES - currentCount;
  const limit = Math.min(slotsAvailable, CANDIDATE_BATCH_LIMIT);

  const candidates = await systemQuery<CandidatePolicy>(
    `SELECT id, policy_type, agent_role, content, eval_score, created_at
     FROM policy_versions
     WHERE status = 'candidate'
       AND eval_score >= $1
       AND created_at < NOW() - INTERVAL '${CANDIDATE_MIN_AGE_HOURS} hours'
     ORDER BY eval_score DESC, created_at ASC
     LIMIT $2`,
    [CANDIDATE_MIN_SCORE, limit],
  );

  if (candidates.length === 0) {
    console.log(`${LOG_PREFIX} Phase 1: No eligible candidates for canary promotion`);
    return;
  }

  for (const candidate of candidates) {
    try {
      // Snapshot previous policy value and apply the new one
      const snapshot = await snapshotAndApplyPolicy(candidate);

      // Update status to canary with snapshot in eval_details
      await systemQuery(
        `UPDATE policy_versions
         SET status = 'canary', promoted_at = NOW(),
             eval_details = COALESCE(eval_details, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ canary_snapshot: snapshot }), candidate.id],
      );

      // Log to activity_log
      await logActivity(
        'policy.canary_promoted',
        `Policy ${candidate.id} (${candidate.policy_type}) promoted to canary for agent ${candidate.agent_role ?? 'system'}`,
      );

      report.promoted_to_canary++;
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to promote candidate ${candidate.id}:`, (err as Error).message);
    }
  }
}

// ─── Phase 2: Check Active Canaries ─────────────────────────────

async function checkCanaries(report: CanaryReport, eventBus?: GlyphorEventBus): Promise<void> {
  const canaries = await systemQuery<CanaryPolicy>(
    `SELECT id, policy_type, agent_role, content, eval_details, promoted_at
     FROM policy_versions
     WHERE status = 'canary'`,
    [],
  );

  if (canaries.length === 0) {
    console.log(`${LOG_PREFIX} Phase 2: No active canaries to check`);
    return;
  }

  for (const canary of canaries) {
    try {
      const agentRole = canary.agent_role;
      const promotedAt = new Date(canary.promoted_at);
      const ageDays = (Date.now() - promotedAt.getTime()) / (1000 * 60 * 60 * 24);

      // Query task_run_outcomes for the affected agent since promoted_at
      const canaryRuns = await systemQuery<{ avg_quality: number; run_count: number }>(
        `SELECT ROUND(AVG(batch_quality_score)::numeric, 2)::float AS avg_quality,
                COUNT(*)::int AS run_count
         FROM task_run_outcomes
         WHERE agent_role = $1
           AND batch_quality_score IS NOT NULL
           AND created_at >= $2`,
        [agentRole, canary.promoted_at],
      );

      const runCount = canaryRuns[0]?.run_count ?? 0;
      const canaryAvg = canaryRuns[0]?.avg_quality ?? 0;

      // Not enough data yet
      if (runCount < CANARY_MIN_RUNS) {
        // Check if canary is too old without enough data
        if (ageDays > CANARY_MAX_AGE_DAYS) {
          await revertCanary(canary, 'insufficient_data', `Only ${runCount} runs after ${Math.round(ageDays)} days`);
          report.rolled_back++;
          report.insufficient_data++;
          await emitCanaryEvent(eventBus, 'policy.canary_reverted', canary, 'insufficient_data');
        }
        // Otherwise just skip — not enough data yet
        continue;
      }

      // Get 30-day pre-canary baseline for this agent
      const baseline = await systemQuery<{ avg_quality: number }>(
        `SELECT ROUND(AVG(batch_quality_score)::numeric, 2)::float AS avg_quality
         FROM task_run_outcomes
         WHERE agent_role = $1
           AND batch_quality_score IS NOT NULL
           AND created_at >= NOW() - INTERVAL '${BASELINE_LOOKBACK_DAYS} days'
           AND created_at < $2`,
        [agentRole, canary.promoted_at],
      );

      const baselineAvg = baseline[0]?.avg_quality ?? 3.0;

      // Decision: promote, revert, or wait
      if (canaryAvg >= baselineAvg - CANARY_PROMOTE_TOLERANCE && runCount >= CANARY_PROMOTE_RUNS) {
        // PROMOTE to active
        await promoteToActive(canary, canaryAvg, baselineAvg);
        report.promoted_to_active++;
        await emitCanaryEvent(eventBus, 'policy.canary_activated', canary, `canary=${canaryAvg} baseline=${baselineAvg}`);
      } else if (canaryAvg < baselineAvg - CANARY_REVERT_THRESHOLD) {
        // REVERT — regression detected
        await revertCanary(canary, 'regression_detected', `canary=${canaryAvg} < baseline=${baselineAvg} - ${CANARY_REVERT_THRESHOLD}`);
        report.rolled_back++;
        await emitCanaryEvent(eventBus, 'policy.canary_reverted', canary, 'regression_detected');
      } else if (ageDays > CANARY_MAX_AGE_DAYS) {
        // REVERT — too old without conclusive data
        await revertCanary(canary, 'insufficient_data', `Inconclusive after ${Math.round(ageDays)} days: canary=${canaryAvg} baseline=${baselineAvg}`);
        report.rolled_back++;
        report.insufficient_data++;
        await emitCanaryEvent(eventBus, 'policy.canary_reverted', canary, 'insufficient_data');
      }
      // Otherwise, continue waiting for more data
    } catch (err) {
      console.warn(`${LOG_PREFIX} Canary check failed for ${canary.id}:`, (err as Error).message);
    }
  }
}

// ─── Promote Canary to Active ───────────────────────────────────

async function promoteToActive(canary: CanaryPolicy, canaryAvg: number, baselineAvg: number): Promise<void> {
  // Mark the previous active policy for the same type+role as superseded
  await systemQuery(
    `UPDATE policy_versions
     SET status = 'superseded'
     WHERE policy_type = $1
       AND ($2::TEXT IS NULL AND agent_role IS NULL OR agent_role = $2)
       AND status = 'active'
       AND id != $3`,
    [canary.policy_type, canary.agent_role, canary.id],
  );

  // Promote canary to active
  await systemQuery(
    `UPDATE policy_versions
     SET status = 'active',
         eval_details = COALESCE(eval_details, '{}'::jsonb) || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({
      activation: {
        canary_avg: canaryAvg,
        baseline_avg: baselineAvg,
        activated_at: new Date().toISOString(),
      },
    }), canary.id],
  );

  await logActivity(
    'policy.activated',
    `Policy ${canary.id} (${canary.policy_type}) promoted to active for ${canary.agent_role ?? 'system'} — canary=${canaryAvg} baseline=${baselineAvg}`,
  );
}

// ─── Revert Canary ──────────────────────────────────────────────

async function revertCanary(canary: CanaryPolicy, reason: string, detail: string): Promise<void> {
  // Restore previous policy value from snapshot
  const snapshot = (canary.eval_details as Record<string, unknown>)?.canary_snapshot as PolicySnapshot | undefined;
  if (snapshot?.previous_value != null) {
    try {
      await revertPolicy(canary.policy_type, canary.agent_role, snapshot.previous_value);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Revert application failed for ${canary.id}:`, (err as Error).message);
    }
  }

  // Update status to rolled_back
  await systemQuery(
    `UPDATE policy_versions
     SET status = 'rolled_back',
         eval_details = COALESCE(eval_details, '{}'::jsonb) || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({
      rollback: {
        reason,
        detail,
        rolled_back_at: new Date().toISOString(),
      },
    }), canary.id],
  );

  await logActivity(
    'policy.rolled_back',
    `Policy ${canary.id} (${canary.policy_type}) rolled back for ${canary.agent_role ?? 'system'}: ${reason} — ${detail}`,
  );
}

// ─── Policy Application (Idempotent) ────────────────────────────

async function snapshotAndApplyPolicy(candidate: CandidatePolicy): Promise<PolicySnapshot> {
  const content = candidate.content;
  const agentRole = candidate.agent_role;
  const now = new Date().toISOString();

  let previousValue: unknown = null;

  switch (candidate.policy_type) {
    case 'prompt': {
      // Snapshot current system_prompt from agent_briefs
      if (agentRole) {
        const rows = await systemQuery<{ system_prompt: string }>(
          `SELECT system_prompt FROM agent_briefs WHERE agent_id = $1`,
          [agentRole],
        );
        previousValue = rows[0]?.system_prompt ?? null;

        // Apply new prompt (merge suggestions into existing prompt)
        const suggestions = (content.suggestions as string[]) ?? [];
        if (suggestions.length > 0 && previousValue) {
          const updatedPrompt = `${previousValue}\n\n/* Canary policy ${candidate.id} */\n${suggestions.join('\n')}`;
          await systemQuery(
            `INSERT INTO agent_briefs (agent_id, system_prompt, updated_at) VALUES ($1, $2, $3)
             ON CONFLICT (agent_id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, updated_at = EXCLUDED.updated_at`,
            [agentRole, updatedPrompt, now],
          );
        }
      }
      break;
    }

    case 'routing': {
      // Snapshot current routing config (stored in eval_details for reference)
      previousValue = { agent_role: agentRole, routing_note: 'routing override applied' };
      // Routing overrides are application-level — log the override for the event router
      console.log(`${LOG_PREFIX} Routing canary applied for ${agentRole}: ${JSON.stringify(content)}`);
      break;
    }

    case 'model_selection': {
      // Snapshot current model from company_agents
      if (agentRole) {
        const rows = await systemQuery<{ model: string }>(
          `SELECT model FROM company_agents WHERE role = $1`,
          [agentRole],
        );
        previousValue = rows[0]?.model ?? null;

        // Apply new model
        const suggestedModel = content.suggested_model as string | undefined;
        if (suggestedModel) {
          await systemQuery(
            `UPDATE company_agents SET model = $1, updated_at = $2 WHERE role = $3`,
            [suggestedModel, now, agentRole],
          );
        }
      }
      break;
    }

    case 'constitution': {
      // Snapshot current constitution for the agent
      if (agentRole) {
        const rows = await systemQuery<{ principles: unknown }>(
          `SELECT principles FROM agent_constitutions WHERE agent_role = $1`,
          [agentRole],
        );
        previousValue = rows[0]?.principles ?? null;

        // Apply constitutional amendment
        const action = content.action as string | undefined;
        const principleText = content.principle_text as string | undefined;
        if (action === 'add' && principleText) {
          await systemQuery(
            `INSERT INTO agent_constitutions (agent_role, principles, updated_at) VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (agent_role) DO UPDATE SET
               principles = agent_constitutions.principles || $2::jsonb,
               updated_at = EXCLUDED.updated_at`,
            [agentRole, JSON.stringify([principleText]), now],
          );
        }
      }
      break;
    }

    case 'rubric': {
      // Snapshot current rubric
      const rubricName = content.name as string | undefined;
      if (rubricName && agentRole) {
        const rows = await systemQuery<{ steps: unknown; description: string }>(
          `SELECT steps, description FROM role_rubrics WHERE agent_role = $1 AND name = $2`,
          [agentRole, rubricName],
        );
        previousValue = rows[0] ?? null;

        // Apply or update the rubric
        await systemQuery(
          `INSERT INTO role_rubrics (agent_role, name, description, steps, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (agent_role, name) DO UPDATE SET
             description = EXCLUDED.description,
             steps = EXCLUDED.steps,
             updated_at = EXCLUDED.updated_at`,
          [agentRole, rubricName, content.description ?? '', JSON.stringify(content.steps ?? []), now],
        );
      }
      break;
    }

    default:
      console.warn(`${LOG_PREFIX} Unknown policy type for application: ${candidate.policy_type}`);
  }

  return { previous_value: previousValue, snapshot_at: now };
}

// ─── Policy Revert (Idempotent) ─────────────────────────────────

async function revertPolicy(policyType: string, agentRole: string | null, previousValue: unknown): Promise<void> {
  const now = new Date().toISOString();

  switch (policyType) {
    case 'prompt': {
      if (agentRole && typeof previousValue === 'string') {
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, updated_at = EXCLUDED.updated_at`,
          [agentRole, previousValue, now],
        );
      }
      break;
    }

    case 'routing': {
      // Routing reverts are application-level — log the revert
      console.log(`${LOG_PREFIX} Routing canary reverted for ${agentRole}`);
      break;
    }

    case 'model_selection': {
      if (agentRole && typeof previousValue === 'string') {
        await systemQuery(
          `UPDATE company_agents SET model = $1, updated_at = $2 WHERE role = $3`,
          [previousValue, now, agentRole],
        );
      }
      break;
    }

    case 'constitution': {
      if (agentRole && previousValue != null) {
        await systemQuery(
          `UPDATE agent_constitutions SET principles = $1::jsonb, updated_at = $2 WHERE agent_role = $3`,
          [JSON.stringify(previousValue), now, agentRole],
        );
      }
      break;
    }

    case 'rubric': {
      if (agentRole && previousValue != null) {
        const prev = previousValue as { steps?: unknown; description?: string; name?: string };
        if (prev.steps) {
          await systemQuery(
            `UPDATE role_rubrics SET steps = $1::jsonb, description = $2, updated_at = $3
             WHERE agent_role = $4 AND name = $5`,
            [JSON.stringify(prev.steps), prev.description ?? '', now, agentRole, prev.name ?? ''],
          );
        }
      }
      break;
    }

    default:
      console.warn(`${LOG_PREFIX} Unknown policy type for revert: ${policyType}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────

async function logActivity(action: string, detail: string): Promise<void> {
  try {
    await systemQuery(
      'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)',
      ['system', 'system', action, detail, new Date().toISOString()],
    );
  } catch (err) {
    console.warn(`${LOG_PREFIX} Activity log failed:`, (err as Error).message);
  }
}

async function emitCanaryEvent(
  eventBus: GlyphorEventBus | undefined,
  action: string,
  canary: CanaryPolicy,
  reason: string,
): Promise<void> {
  if (!eventBus) return;
  // Map canary actions to valid GlyphorEventType values
  const eventType = (action.includes('reverted') ? 'alert.triggered' : 'insight.detected') as GlyphorEventType;
  try {
    await eventBus.emit({
      type: eventType,
      source: 'system',
      payload: {
        action,
        policy_id: canary.id,
        policy_type: canary.policy_type,
        agent_role: canary.agent_role,
        reason,
      },
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} Event emission failed for ${action}:`, (err as Error).message);
  }
}
