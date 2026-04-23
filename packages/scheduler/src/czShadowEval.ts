/**
 * Shadow-eval for CZ reflection-generated prompt mutations.
 *
 * Closes the loop between `processCzBatchFailures` (which STAGES prompt
 * mutations) and the deployed prompt (which humans currently promote
 * manually via the dashboard). The flow:
 *
 *   1. Reflection stages a challenger       (czReflectionBridge.ts — existing)
 *   2. createShadowEval() queues a canary   (this file — NEW)
 *   3. runShadowCanary() executes the canary against the challenger's
 *      target_task_ids using prompt_version_id override            (NEW)
 *   4. evaluateShadowAttempt() compares to baseline, decides win   (NEW)
 *   5. On required_wins consecutive wins → auto-promote            (NEW)
 *   6. On max_attempts without wins      → mark shadow_failed      (NEW)
 *   7. On stuck pattern (same tag repeating) → human_review        (NEW)
 *
 * The orchestrator (Sarah's cz_protocol_loop workflow) drives this by
 * calling findReadyShadowEvals() + runShadowCanary() on a schedule.
 * None of this runs on its own — it waits to be poked by the loop so
 * humans stay in control of pacing.
 *
 * Design notes:
 *   - We compare challenger pass rate on its TARGET tasks (the ones it was
 *     staged to fix) against the BASELINE snapshot taken at eval creation.
 *     We don't re-measure the baseline on every attempt — if the baseline
 *     is drifting, that's a separate signal.
 *   - The canary uses the same executor (executeBatch) as normal runs;
 *     the only difference is that cz_runs.prompt_version_id is set, and
 *     the agent runner picks up the challenger prompt via the override.
 *   - Auto-reassignment (for agent_retired / misrouted infra tasks) lives
 *     here too since it shares the "automated corrective action" category.
 */

import { systemQuery, systemTransaction } from '@glyphor/shared/db';

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type ShadowEvalState =
  | 'shadow_pending'
  | 'shadow_running'
  | 'shadow_passed'
  | 'shadow_failed'
  | 'human_review'
  | 'auto_promoted';

export interface ShadowEvalRow {
  id: string;
  prompt_version_id: string;
  agent_id: string;
  tenant_id: string;
  target_task_ids: string[];
  promotion_margin: number;
  required_wins: number;
  max_attempts: number;
  state: ShadowEvalState;
  consecutive_wins: number;
  attempts_used: number;
  baseline_pass_rate: number | null;
  baseline_avg_score: number | null;
  last_pass_rate: number | null;
  last_avg_score: number | null;
  last_batch_id: string | null;
  last_ran_at: string | null;
  escalation_reason: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AutomationConfig {
  loop_enabled: boolean;
  shadow_eval_enabled: boolean;
  auto_reassign_enabled: boolean;
  stuck_threshold_attempts: number;
  slack_escalation_channel: string;
  // Promotion gate defaults — tightened 2026-04-22 after mass drift regression.
  // These override the hardcoded fallbacks when present in cz_automation_config.
  promotion_margin_default: number;
  required_wins_default: number;
  max_attempts_default: number;
}

/* ══════════════════════════════════════════════════════════════
   Config
   ══════════════════════════════════════════════════════════════ */

export async function loadAutomationConfig(): Promise<AutomationConfig> {
  const rows = await systemQuery<{ key: string; value_json: unknown }>(
    `SELECT key, value_json FROM cz_automation_config
      WHERE key IN (
        'loop_enabled','shadow_eval_enabled','auto_reassign_enabled',
        'stuck_threshold_attempts','slack_escalation_channel',
        'promotion_margin_default','required_wins_default','max_attempts_default'
      )`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value_json]));
  return {
    loop_enabled:              (map.get('loop_enabled') as boolean)              ?? true,
    shadow_eval_enabled:       (map.get('shadow_eval_enabled') as boolean)       ?? true,
    auto_reassign_enabled:     (map.get('auto_reassign_enabled') as boolean)     ?? true,
    stuck_threshold_attempts:  (map.get('stuck_threshold_attempts') as number)   ?? 5,
    slack_escalation_channel:  (map.get('slack_escalation_channel') as string)   ?? '#cz-automation',
    promotion_margin_default:  Number(map.get('promotion_margin_default') ?? 0.30),
    required_wins_default:     Number(map.get('required_wins_default')    ?? 3),
    max_attempts_default:      Number(map.get('max_attempts_default')     ?? 5),
  };
}

/* ══════════════════════════════════════════════════════════════
   Create a shadow-eval for a staged challenger
   ══════════════════════════════════════════════════════════════ */

/**
 * Called by `processCzBatchFailures` in czReflectionBridge.ts immediately
 * after it stages a prompt mutation (INSERT into agent_prompt_versions
 * with deployed_at NULL).
 *
 * Discovers the failing tasks for this agent, snapshots the baseline
 * pass rate, and creates a cz_shadow_evals row in state=shadow_pending.
 * The next orchestrator tick will pick it up and run the first canary.
 *
 * Returns the shadow_eval_id, or null if no shadow eval was created
 * (e.g. no target tasks, or the version already has a shadow eval).
 */
export async function createShadowEval(args: {
  prompt_version_id: string;
  agent_id: string;
  tenant_id: string;
  // Optional overrides — when the reflection bridge knows exactly which
  // tasks this challenger is meant to fix, it can pass them directly.
  // Otherwise we infer from the agent's currently-failing tasks.
  target_task_ids?: string[];
  promotion_margin?: number;
  required_wins?: number;
  max_attempts?: number;
}): Promise<string | null> {
  const cfg = await loadAutomationConfig();
  if (!cfg.shadow_eval_enabled) {
    console.log(`[ShadowEval] disabled by config; skipping eval for ${args.agent_id}`);
    return null;
  }

  // Idempotency: one shadow eval per version.
  const existing = await systemQuery<{ id: string }>(
    'SELECT id FROM cz_shadow_evals WHERE prompt_version_id = $1',
    [args.prompt_version_id],
  );
  if (existing.length > 0) return existing[0].id;

  // Target tasks: explicit list, or infer from currently-failing tasks for
  // this agent. We map agent_id (the runtime role like 'chief-of-staff')
  // back to the persona name stored in cz_tasks.responsible_agent using
  // the same AGENT_NAME_TO_ROLE map that the executor uses — inverted.
  let targetIds = args.target_task_ids ?? [];
  if (targetIds.length === 0) {
    const inferred = await systemQuery<{ task_id: string }>(`
      WITH latest AS (
        SELECT DISTINCT ON (r.task_id) r.task_id, s.passed
        FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
        WHERE r.completed_at IS NOT NULL
        ORDER BY r.task_id, r.completed_at DESC
      )
      SELECT t.id AS task_id
      FROM cz_tasks t
      JOIN latest l ON l.task_id = t.id
      WHERE t.active = true
        AND l.passed = false
        AND (
          -- match runtime role OR persona name
          t.responsible_agent = $1
          OR LOWER(t.responsible_agent) = ANY($2::text[])
        )
      ORDER BY t.is_p0 DESC, t.task_number
      LIMIT 20
    `, [args.agent_id, personasForRole(args.agent_id)]);
    targetIds = inferred.map((r) => r.task_id);
  }

  if (targetIds.length === 0) {
    console.log(`[ShadowEval] no failing target tasks for ${args.agent_id} v${args.prompt_version_id.slice(0,8)}; skipping`);
    return null;
  }

  // Baseline snapshot — what the challenger needs to beat.
  const baseline = await systemQuery<{
    pass_rate: number | null;
    avg_score: number | null;
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON (r.task_id) r.task_id, s.passed, s.judge_score
      FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
      WHERE r.completed_at IS NOT NULL AND r.task_id = ANY($1)
      ORDER BY r.task_id, r.completed_at DESC
    )
    SELECT
      (COUNT(*) FILTER (WHERE passed = true)::float / NULLIF(COUNT(*), 0))::numeric(4,3) AS pass_rate,
      AVG(judge_score)::numeric(4,2) AS avg_score
    FROM latest
  `, [targetIds]);

  const rows = await systemQuery<{ id: string }>(`
    INSERT INTO cz_shadow_evals (
      prompt_version_id, agent_id, tenant_id, target_task_ids,
      promotion_margin, required_wins, max_attempts,
      baseline_pass_rate, baseline_avg_score
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `, [
    args.prompt_version_id,
    args.agent_id,
    args.tenant_id,
    targetIds,
    args.promotion_margin ?? cfg.promotion_margin_default,
    args.required_wins    ?? cfg.required_wins_default,
    args.max_attempts     ?? cfg.max_attempts_default,
    baseline[0]?.pass_rate ?? 0,
    baseline[0]?.avg_score ?? null,
  ]);

  console.log(
    `[ShadowEval] created ${rows[0].id.slice(0,8)} for ${args.agent_id} ` +
    `v_prompt=${args.prompt_version_id.slice(0,8)} ` +
    `targets=${targetIds.length} baseline=${baseline[0]?.pass_rate ?? 0}`,
  );
  return rows[0].id;
}

/** Inverse of AGENT_NAME_TO_ROLE in czProtocolApi.ts. */
function personasForRole(role: string): string[] {
  const map: Record<string, string[]> = {
    'chief-of-staff': ['sarah'],
    cto: ['marcus'],
    cfo: ['nadia'],
    cpo: ['elena'],
    cmo: ['maya'],
    'vp-design': ['mia'],
    'vp-sales': ['rachel'],
    'vp-research': ['vp-research'],  // stored as role, no persona alias
    ops: ['atlas'],
    clo: ['victoria'],
    'content-creator': ['tyler'],
    'seo-analyst': ['lisa'],
    'social-media-manager': ['kai'],
  };
  return map[role] ?? [role.toLowerCase()];
}

/* ══════════════════════════════════════════════════════════════
   Backfill — reconcile orphan reflection versions
   ══════════════════════════════════════════════════════════════ */

/**
 * Find reflection-sourced prompt versions from the last 48h that have no
 * corresponding cz_shadow_evals row, and try to create one for each.
 *
 * This exists because the main createShadowEval call inside the reflection
 * bridge has silently failed in production (tenant/RLS quirks on the INSERT
 * into cz_shadow_evals). Calling this after every batch self-heals.
 *
 * Returns { reconciled, failed } so the caller can log stats.
 */
export async function backfillOrphanReflections(): Promise<{
  reconciled: number;
  failed: number;
  skipped: number;
}> {
  const stats = { reconciled: 0, failed: 0, skipped: 0 };

  const orphans = await systemQuery<{
    id: string;
    agent_id: string;
    tenant_id: string;
    version: number;
  }>(`
    SELECT apv.id, apv.agent_id, apv.tenant_id, apv.version
      FROM agent_prompt_versions apv
     WHERE apv.source IN ('reflection','cz_reflection')
       AND apv.deployed_at IS NULL
       AND apv.retired_at IS NULL
       AND apv.created_at > NOW() - INTERVAL '48 hours'
       AND NOT EXISTS (
         SELECT 1 FROM cz_shadow_evals se
          WHERE se.prompt_version_id = apv.id
       )
     ORDER BY apv.created_at ASC
     LIMIT 20
  `);

  if (orphans.length === 0) return stats;

  console.log(`[ShadowEval:backfill] found ${orphans.length} orphan reflection versions`);

  for (const o of orphans) {
    try {
      const id = await createShadowEval({
        prompt_version_id: o.id,
        agent_id: o.agent_id,
        tenant_id: o.tenant_id,
      });
      if (id) {
        console.log(`[ShadowEval:backfill] reconciled ${o.agent_id} v${o.version} -> ${id.slice(0,8)}`);
        stats.reconciled++;
      } else {
        stats.skipped++;
      }
    } catch (e) {
      console.error(
        `[ShadowEval:backfill] failed ${o.agent_id} v${o.version}:`,
        e instanceof Error ? e.message : e,
      );
      stats.failed++;
    }
  }

  return stats;
}

/* ══════════════════════════════════════════════════════════════
   Orchestrator entry points — called by Sarah's loop
   ══════════════════════════════════════════════════════════════ */

/**
 * Find shadow-evals that need a canary attempt now.
 * Returns evals in shadow_pending, plus evals in shadow_running whose
 * last canary completed (we detect this by checking if last_batch_id's
 * runs are all in a terminal status).
 */
export async function findReadyShadowEvals(): Promise<ShadowEvalRow[]> {
  const rows = await systemQuery<ShadowEvalRow>(`
    SELECT e.* FROM cz_shadow_evals e
    WHERE e.state = 'shadow_pending'
       OR (
         e.state = 'shadow_running'
         AND e.last_batch_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cz_runs r
            WHERE r.batch_id = e.last_batch_id
              AND r.status IN ('queued','running')
         )
       )
    ORDER BY e.created_at
    LIMIT 10
  `);
  return rows;
}

/**
 * Kick off (or evaluate) one canary attempt for a shadow-eval.
 *
 * If state=shadow_pending: queues a new canary batch and flips state to
 *   shadow_running. The actual execution happens async inside executeBatch.
 *
 * If state=shadow_running AND the last batch is done: reads the scores,
 *   updates the eval with the attempt's pass rate, decides:
 *     - was_win? consecutive_wins++; if >= required_wins → autoPromote
 *     - not a win? consecutive_wins=0; attempts_used++; if >= max_attempts
 *       OR stuck pattern detected → escalate or mark failed
 *
 * Returns the new state so the orchestrator can log/act on it.
 */
export async function runShadowCanary(
  shadowEvalId: string,
  // Injected by the caller — avoids a circular import on czProtocolApi.ts.
  queueCanaryBatch: (args: {
    task_ids: string[];
    prompt_version_id: string;
    triggered_by: string;
  }) => Promise<string>,
): Promise<ShadowEvalState> {
  const evalRows = await systemQuery<ShadowEvalRow>(
    'SELECT * FROM cz_shadow_evals WHERE id = $1',
    [shadowEvalId],
  );
  if (!evalRows.length) throw new Error(`ShadowEval ${shadowEvalId} not found`);
  const se = evalRows[0];

  if (se.state === 'shadow_pending') {
    // Queue the first canary
    const batchId = await queueCanaryBatch({
      task_ids: se.target_task_ids,
      prompt_version_id: se.prompt_version_id,
      triggered_by: 'auto:shadow-eval',
    });
    await systemQuery(`
      UPDATE cz_shadow_evals
        SET state='shadow_running', last_batch_id=$2,
            last_ran_at=NOW(), updated_at=NOW()
        WHERE id=$1
    `, [se.id, batchId]);
    await systemQuery(`
      INSERT INTO cz_shadow_attempts (shadow_eval_id, attempt_number, batch_id)
        VALUES ($1, $2, $3)
    `, [se.id, se.attempts_used + 1, batchId]);
    console.log(`[ShadowEval] ${se.id.slice(0,8)} attempt ${se.attempts_used + 1} queued as batch ${batchId.slice(0,8)}`);
    return 'shadow_running';
  }

  if (se.state === 'shadow_running' && se.last_batch_id) {
    // Evaluate the completed batch
    return evaluateShadowAttempt(se);
  }

  return se.state;
}

/**
 * Read the outcome of the most recent canary batch, score it against
 * baseline, and advance the shadow-eval state machine.
 */
async function evaluateShadowAttempt(se: ShadowEvalRow): Promise<ShadowEvalState> {
  if (!se.last_batch_id) return se.state;

  const outcome = await systemQuery<{
    pass_rate: number | null;
    avg_score: number | null;
    heuristic_tags: string[];
  }>(`
    SELECT
      (COUNT(*) FILTER (WHERE s.passed = true)::float / NULLIF(COUNT(*), 0))::numeric(4,3) AS pass_rate,
      AVG(s.judge_score)::numeric(4,2) AS avg_score,
      COALESCE(
        ARRAY_AGG(DISTINCT h) FILTER (WHERE h IS NOT NULL),
        ARRAY[]::text[]
      ) AS heuristic_tags
    FROM cz_runs r
    JOIN cz_scores s ON s.run_id = r.id
    LEFT JOIN LATERAL UNNEST(s.heuristic_failures) AS h ON true
    WHERE r.batch_id = $1
  `, [se.last_batch_id]);

  const challengerPassRate = Number(outcome[0]?.pass_rate ?? 0);
  const challengerAvgScore = Number(outcome[0]?.avg_score ?? 0);
  const baselinePassRate   = Number(se.baseline_pass_rate ?? 0);
  const delta              = challengerPassRate - baselinePassRate;
  // Zero-baseline escape hatch: when the deployed prompt is at 0% pass rate,
  // a relative-delta margin is mathematically unreachable with small canary
  // batches. Treat any challenger that clears an absolute 10% pass rate as a
  // win so the loop can actually climb out of total failure. 2026-04-23.
  const ZERO_BASELINE_ABSOLUTE_FLOOR = 0.10;
  const wasWin =
    baselinePassRate === 0
      ? challengerPassRate >= ZERO_BASELINE_ABSOLUTE_FLOOR
      : delta >= Number(se.promotion_margin);
  const attemptNumber      = se.attempts_used + 1;
  const tags               = outcome[0]?.heuristic_tags ?? [];

  // Record the attempt
  await systemQuery(`
    UPDATE cz_shadow_attempts
       SET challenger_pass_rate=$2, challenger_avg_score=$3,
           delta_vs_baseline=$4, was_win=$5,
           heuristic_tags_seen=$6, completed_at=NOW()
     WHERE shadow_eval_id=$1 AND attempt_number=$7
  `, [se.id, challengerPassRate, challengerAvgScore, delta, wasWin, tags, attemptNumber]);

  const newConsecutiveWins = wasWin ? se.consecutive_wins + 1 : 0;
  const newAttemptsUsed    = se.attempts_used + 1;

  // Decision tree
  if (newConsecutiveWins >= se.required_wins) {
    await autoPromote(se, challengerPassRate, challengerAvgScore);
    return 'auto_promoted';
  }

  // Stuck detection: same tags firing on every attempt with no improvement.
  const stuck = await detectStuckPattern(se.id);
  if (stuck) {
    await escalate(se.id, `stuck pattern — heuristics "${stuck.join(', ')}" repeating across ${newAttemptsUsed} attempts with no pass-rate improvement`);
    return 'human_review';
  }

  if (newAttemptsUsed >= se.max_attempts) {
    await systemQuery(`
      UPDATE cz_shadow_evals
         SET state='shadow_failed',
             consecutive_wins=$2, attempts_used=$3,
             last_pass_rate=$4, last_avg_score=$5,
             updated_at=NOW()
       WHERE id=$1
    `, [se.id, newConsecutiveWins, newAttemptsUsed, challengerPassRate, challengerAvgScore]);
    // Retire the challenger so it stops appearing in the Staged Fixes panel.
    await systemQuery(`
      UPDATE agent_prompt_versions SET retired_at = NOW()
        WHERE id = $1 AND deployed_at IS NULL AND retired_at IS NULL
    `, [se.prompt_version_id]);
    console.log(`[ShadowEval] ${se.id.slice(0,8)} FAILED — ${newAttemptsUsed} attempts, best delta ${delta.toFixed(3)} < ${se.promotion_margin}`);
    return 'shadow_failed';
  }

  // Queue the next attempt (state stays shadow_running; orchestrator will
  // pick it up on next tick because last_batch_id is now terminal).
  await systemQuery(`
    UPDATE cz_shadow_evals
       SET state='shadow_pending',
           consecutive_wins=$2, attempts_used=$3,
           last_pass_rate=$4, last_avg_score=$5,
           updated_at=NOW()
     WHERE id=$1
  `, [se.id, newConsecutiveWins, newAttemptsUsed, challengerPassRate, challengerAvgScore]);
  console.log(`[ShadowEval] ${se.id.slice(0,8)} attempt ${newAttemptsUsed} ${wasWin ? 'WIN' : 'no-win'} delta=${delta.toFixed(3)} (need +${se.promotion_margin}), consecutive=${newConsecutiveWins}/${se.required_wins}`);
  return 'shadow_pending';
}

/**
 * Atomically retire the current baseline and deploy the challenger.
 * Mirrors the manual /fixes/:id/promote endpoint but with provenance set
 * to 'shadow_promoted' so we can distinguish auto from manual promotions.
 */
async function autoPromote(
  se: ShadowEvalRow,
  finalPassRate: number,
  finalAvgScore: number,
): Promise<void> {
  await systemTransaction(async (client) => {
    await client.query(`
      UPDATE agent_prompt_versions
         SET retired_at = NOW()
       WHERE tenant_id = $1 AND agent_id = $2
         AND deployed_at IS NOT NULL AND retired_at IS NULL
    `, [se.tenant_id, se.agent_id]);
    await client.query(`
      UPDATE agent_prompt_versions
         SET deployed_at = NOW(), source = 'shadow_promoted'
       WHERE id = $1
    `, [se.prompt_version_id]);
    await client.query(`
      UPDATE cz_shadow_evals
         SET state='auto_promoted',
             last_pass_rate=$2, last_avg_score=$3,
             consecutive_wins=consecutive_wins + 1,
             attempts_used=attempts_used + 1,
             updated_at=NOW()
       WHERE id=$1
    `, [se.id, finalPassRate, finalAvgScore]);
  });
  console.log(
    `[ShadowEval] AUTO-PROMOTED ${se.agent_id} v_prompt=${se.prompt_version_id.slice(0,8)} ` +
    `after ${se.required_wins} consecutive wins ` +
    `(final pass_rate=${finalPassRate}, baseline=${se.baseline_pass_rate})`,
  );
  // Audit sampling hook — every Nth auto-promotion should be flagged for
  // eyeball review. Caller (Sarah's workflow) decides how to surface this.
  await maybeFlagForAudit(se.id);
}

/**
 * Flag every Nth auto-promoted change for human audit, so drift from the
 * heuristic catalog can't silently go live. N=5 by default.
 */
async function maybeFlagForAudit(shadowEvalId: string): Promise<void> {
  const countRows = await systemQuery<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM cz_shadow_evals WHERE state='auto_promoted'",
  );
  const n = countRows[0]?.n ?? 0;
  if (n % 5 === 0) {
    await systemQuery(`
      UPDATE cz_shadow_evals
         SET escalation_reason='audit_sample — every 5th auto-promotion flagged for human eyeball review',
             escalated_at=NOW()
       WHERE id=$1
    `, [shadowEvalId]);
  }
}

/**
 * Detect the "same heuristic tags firing across attempts with no pass-rate
 * improvement" pattern. This is the signal that prompt tweaks aren't
 * actually addressing the failure mode — typically means the issue needs
 * reassignment, code changes, or a task-definition fix, not another
 * prompt iteration.
 */
async function detectStuckPattern(shadowEvalId: string): Promise<string[] | null> {
  const attempts = await systemQuery<{
    attempt_number: number;
    challenger_pass_rate: number | null;
    heuristic_tags_seen: string[] | null;
  }>(`
    SELECT attempt_number, challenger_pass_rate, heuristic_tags_seen
      FROM cz_shadow_attempts
      WHERE shadow_eval_id=$1 AND completed_at IS NOT NULL
      ORDER BY attempt_number
  `, [shadowEvalId]);
  if (attempts.length < 2) return null;

  // Pass rate not improving: each attempt <= the previous + a small epsilon.
  const rates = attempts.map((a) => Number(a.challenger_pass_rate ?? 0));
  const noImprovement = rates.every((r, i) => i === 0 || r <= rates[i - 1] + 0.02);

  // Same tags firing every attempt.
  const tagSets = attempts.map((a) => new Set(a.heuristic_tags_seen ?? []));
  if (tagSets[0].size === 0) return null;
  const persistent = [...tagSets[0]].filter((tag) => tagSets.every((s) => s.has(tag)));

  if (noImprovement && persistent.length > 0) return persistent;
  return null;
}

async function escalate(shadowEvalId: string, reason: string): Promise<void> {
  await systemQuery(`
    UPDATE cz_shadow_evals
       SET state='human_review', escalation_reason=$2, escalated_at=NOW(), updated_at=NOW()
     WHERE id=$1
  `, [shadowEvalId, reason]);
  console.log(`[ShadowEval] ESCALATED ${shadowEvalId.slice(0,8)} — ${reason}`);
}

/* ══════════════════════════════════════════════════════════════
   Auto-reassignment — corrective action for misrouted tasks
   ══════════════════════════════════════════════════════════════ */

/**
 * Some heuristic tags (agent_retired, infra_verification_skipped on non-infra
 * roles) have remediations that are a task REASSIGNMENT rather than a prompt
 * change. Reflection can't fix these by definition — the responsible agent
 * is wrong for the task. Run this on every batch completion to clear them
 * automatically.
 *
 * Returns the list of reassignments made, for the orchestrator to log.
 */
export async function autoReassignMisroutedTasks(): Promise<Array<{
  task_id: string;
  task_number: number;
  from: string | null;
  to: string;
  reason: string;
}>> {
  const cfg = await loadAutomationConfig();
  if (!cfg.auto_reassign_enabled) return [];

  // Find tasks where the latest run fired a reassignment-worthy heuristic
  // on 2+ consecutive attempts (to avoid reassigning on a single blip).
  const candidates = await systemQuery<{
    task_id: string;
    task_number: number;
    responsible_agent: string | null;
    pillar: string;
    heuristic_failures: string[];
  }>(`
    WITH last_two AS (
      SELECT r.task_id,
             ROW_NUMBER() OVER (PARTITION BY r.task_id ORDER BY r.completed_at DESC) AS rn,
             s.heuristic_failures, s.passed
        FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
        WHERE r.completed_at IS NOT NULL
    )
    SELECT t.id AS task_id, t.task_number, t.responsible_agent, t.pillar,
           l1.heuristic_failures
      FROM last_two l1
      JOIN last_two l2 ON l2.task_id = l1.task_id AND l2.rn = 2
      JOIN cz_tasks t ON t.id = l1.task_id
     WHERE l1.rn = 1 AND l1.passed = false AND l2.passed = false
       AND t.active = true
       AND (
         EXISTS (SELECT 1 FROM UNNEST(l1.heuristic_failures) h WHERE h LIKE 'agent_retired%')
         AND EXISTS (SELECT 1 FROM UNNEST(l2.heuristic_failures) h WHERE h LIKE 'agent_retired%')
       )
       OR (
         t.pillar IN ('Agentic Security','Data Sovereignty','Governing Shadow AI')
         AND t.responsible_agent NOT IN ('marcus','atlas')
         AND EXISTS (SELECT 1 FROM UNNEST(l1.heuristic_failures) h WHERE h LIKE 'infra_verification_skipped%')
         AND EXISTS (SELECT 1 FROM UNNEST(l2.heuristic_failures) h WHERE h LIKE 'infra_verification_skipped%')
       )
  `);

  const retiredToActive: Record<string, string> = {
    rachel: 'maya',  // vp-sales → cmo
    tyler:  'maya',  // content-creator → cmo
    lisa:   'maya',  // seo-analyst → cmo
    kai:    'maya',  // social-media-manager → cmo
  };

  const reassignments: Array<{ task_id: string; task_number: number; from: string | null; to: string; reason: string }> = [];
  for (const t of candidates) {
    const tags = t.heuristic_failures ?? [];
    let to: string | null = null;
    let reason = '';

    if (tags.some((h) => h.startsWith('agent_retired'))) {
      const current = (t.responsible_agent ?? '').toLowerCase();
      to = retiredToActive[current] ?? 'sarah';
      reason = `responsible agent "${t.responsible_agent}" is retired; reassigning to "${to}"`;
    } else if (tags.some((h) => h.startsWith('infra_verification_skipped'))) {
      to = 'marcus';  // cto
      reason = `infra verification task on non-infra role "${t.responsible_agent}"; reassigning to cto (marcus)`;
    }
    if (!to) continue;

    await systemQuery(
      'UPDATE cz_tasks SET responsible_agent=$2, updated_at=NOW() WHERE id=$1',
      [t.task_id, to],
    );
    reassignments.push({
      task_id: t.task_id,
      task_number: t.task_number,
      from: t.responsible_agent,
      to,
      reason,
    });
    console.log(`[AutoReassign] task #${t.task_number}: ${t.responsible_agent} → ${to} (${reason})`);
  }
  return reassignments;
}

/* ══════════════════════════════════════════════════════════════
   Stop-condition evaluation for the orchestrator
   ══════════════════════════════════════════════════════════════ */

export interface ConvergenceStatus {
  state: 'green' | 'converging' | 'stuck';
  pass_rate: number;
  p0_pass_rate: number;
  gates_met: number;
  gates_total: number;
  trend_7d: number;  // delta in pass rate over last 7 days, signed
  stuck_tasks: Array<{ task_id: string; task_number: number; tag: string; attempts: number }>;
  should_pause_auto_runs: boolean;
}

export async function evaluateConvergence(): Promise<ConvergenceStatus> {
  // Current snapshot
  const [summary, gates, trend, stuck] = await Promise.all([
    systemQuery<{ pass_rate: number; p0_pass_rate: number }>(`
      WITH latest AS (
        SELECT DISTINCT ON (t.id) t.id, t.is_p0, ls.passed
          FROM cz_tasks t LEFT JOIN cz_latest_scores ls ON ls.task_id = t.id
          WHERE t.active = true
          ORDER BY t.id, ls.completed_at DESC NULLS LAST
      )
      SELECT
        (COUNT(*) FILTER (WHERE passed = true)::float / NULLIF(COUNT(*), 0))::numeric(4,3) AS pass_rate,
        (COUNT(*) FILTER (WHERE passed = true AND is_p0)::float / NULLIF(COUNT(*) FILTER (WHERE is_p0), 0))::numeric(4,3) AS p0_pass_rate
        FROM latest
    `),
    // Simplified gate check: launch gates "met" if p0_pass_rate=1.0 AND
    // overall_pass_rate >= 0.85 (matches the common default thresholds).
    // Caller (scorecard endpoint) has the full computation; this is a
    // cheap approximation for stop-condition purposes.
    systemQuery<{ met: number; total: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE TRUE)::int AS total,  -- TODO: compute real met count
        0 AS met
        FROM cz_launch_gates
    `),
    systemQuery<{ trend: number }>(`
      WITH buckets AS (
        SELECT
          CASE WHEN r.completed_at > NOW() - INTERVAL '7 days' THEN 'recent' ELSE 'prior' END AS bucket,
          s.passed
        FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
        WHERE r.completed_at > NOW() - INTERVAL '14 days'
      )
      SELECT (
        COALESCE((COUNT(*) FILTER (WHERE bucket='recent' AND passed=true)::float
          / NULLIF(COUNT(*) FILTER (WHERE bucket='recent'), 0)), 0)
        -
        COALESCE((COUNT(*) FILTER (WHERE bucket='prior'  AND passed=true)::float
          / NULLIF(COUNT(*) FILTER (WHERE bucket='prior'), 0)), 0)
      )::numeric(4,3) AS trend FROM buckets
    `),
    systemQuery<{ task_id: string; task_number: number; tag: string; attempts: number }>(`
      WITH recent_runs AS (
        SELECT r.task_id, r.completed_at, s.passed, s.heuristic_failures,
               ROW_NUMBER() OVER (PARTITION BY r.task_id ORDER BY r.completed_at DESC) AS rn
          FROM cz_runs r JOIN cz_scores s ON s.run_id = r.id
          WHERE r.completed_at > NOW() - INTERVAL '14 days'
      ),
      tags AS (
        SELECT rr.task_id, h AS tag, COUNT(*) AS attempts
          FROM recent_runs rr, UNNEST(rr.heuristic_failures) AS h
          WHERE rr.passed = false
          GROUP BY rr.task_id, h
          HAVING COUNT(*) >= $1
      )
      SELECT t.id AS task_id, t.task_number, tg.tag, tg.attempts::int AS attempts
        FROM tags tg
        JOIN cz_tasks t ON t.id = tg.task_id
        ORDER BY tg.attempts DESC, t.task_number
        LIMIT 10
    `, [(await loadAutomationConfig()).stuck_threshold_attempts]),
  ]);

  const passRate   = Number(summary[0]?.pass_rate ?? 0);
  const p0PassRate = Number(summary[0]?.p0_pass_rate ?? 0);
  const trend7d    = Number(trend[0]?.trend ?? 0);
  const gatesTotal = gates[0]?.total ?? 0;
  const gatesMet   = gates[0]?.met ?? 0;

  // State: green if all gates met and stable; stuck if trend flat + stuck tasks exist; else converging.
  let state: ConvergenceStatus['state'];
  if (p0PassRate >= 1 && passRate >= 0.85) state = 'green';
  else if (stuck.length >= 3 && trend7d <= 0.01) state = 'stuck';
  else state = 'converging';

  return {
    state,
    pass_rate: passRate,
    p0_pass_rate: p0PassRate,
    gates_met: gatesMet,
    gates_total: gatesTotal,
    trend_7d: trend7d,
    stuck_tasks: stuck,
    should_pause_auto_runs: state === 'green',
  };
}
