/**
 * Shadow Promotion — Score-gated promotion of challenger prompt versions.
 *
 * After N≥10 shadow runs accumulate for a challenger version, this module
 * decides whether to promote (deploy) or discard the challenger based on:
 *   1. Challenger must beat baseline by >5%
 *   2. Challenger average must be ≥0.70
 *
 * promotePromptVersion: sets deployed_at on challenger, retired_at on baseline.
 * discardPromptVersion: sets retired_at on challenger without deploying.
 */

import { systemQuery, systemTransaction } from '@glyphor/shared/db';

// ─── Config ─────────────────────────────────────────────────────

const MIN_SHADOW_RUNS = 10;
const IMPROVEMENT_THRESHOLD = 1.05; // Challenger must beat baseline by >5%
const MIN_CHALLENGER_SCORE = 0.70;

// ─── Types ──────────────────────────────────────────────────────

interface ShadowRunRow {
  challenger_score: number;
  baseline_score: number;
}

export type PromotionOutcome = 'promoted' | 'discarded' | 'insufficient_data';

// ─── Core ───────────────────────────────────────────────────────

export async function evaluatePromotion(
  agentId: string,
  challengerVersion: number,
): Promise<PromotionOutcome> {
  const runs = await systemQuery<ShadowRunRow>(
    `SELECT challenger_score, baseline_score
     FROM shadow_runs
     WHERE agent_id = $1 AND challenger_prompt_version = $2 AND status = 'evaluated'`,
    [agentId, challengerVersion],
  );

  if (runs.length < MIN_SHADOW_RUNS) {
    return 'insufficient_data';
  }

  const avgChallenger = avg(runs.map(r => Number(r.challenger_score)));
  const avgBaseline = avg(runs.map(r => Number(r.baseline_score)));

  console.log(
    `[ShadowPromotion] ${agentId} v${challengerVersion}: ` +
    `challenger=${avgChallenger.toFixed(3)} baseline=${avgBaseline.toFixed(3)} ` +
    `runs=${runs.length}`,
  );

  if (avgChallenger > avgBaseline * IMPROVEMENT_THRESHOLD && avgChallenger >= MIN_CHALLENGER_SCORE) {
    await promotePromptVersion(agentId, challengerVersion);
    // Mark shadow runs as promoted
    await systemQuery(
      `UPDATE shadow_runs SET status = 'promoted'
       WHERE agent_id = $1 AND challenger_prompt_version = $2 AND status = 'evaluated'`,
      [agentId, challengerVersion],
    );
    return 'promoted';
  } else {
    await discardPromptVersion(agentId, challengerVersion);
    // Mark shadow runs as discarded
    await systemQuery(
      `UPDATE shadow_runs SET status = 'discarded'
       WHERE agent_id = $1 AND challenger_prompt_version = $2 AND status = 'evaluated'`,
      [agentId, challengerVersion],
    );
    return 'discarded';
  }
}

// ─── Promote: Deploy challenger, retire current baseline ────────

async function promotePromptVersion(agentId: string, challengerVersion: number): Promise<void> {
  await systemTransaction(async (client) => {
    // Retire the current active version
    await client.query(
      `UPDATE agent_prompt_versions
       SET retired_at = NOW()
       WHERE agent_id = $1 AND deployed_at IS NOT NULL AND retired_at IS NULL`,
      [agentId],
    );

    // Deploy the challenger
    await client.query(
      `UPDATE agent_prompt_versions
       SET deployed_at = NOW(), source = 'shadow_promoted'
       WHERE agent_id = $1 AND version = $2`,
      [agentId, challengerVersion],
    );
  });

  console.log(`[ShadowPromotion] PROMOTED ${agentId} to v${challengerVersion}`);
}

// ─── Discard: Retire challenger without deploying ───────────────

async function discardPromptVersion(agentId: string, challengerVersion: number): Promise<void> {
  await systemQuery(
    `UPDATE agent_prompt_versions
     SET retired_at = NOW()
     WHERE agent_id = $1 AND version = $2`,
    [agentId, challengerVersion],
  );

  console.log(`[ShadowPromotion] DISCARDED ${agentId} v${challengerVersion}`);
}

// ─── Helpers ────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Queue a challenger version for shadow evaluation.
 * Marks the version so the scheduler's shadow-eval cron picks it up.
 */
export async function queueShadowEvaluation(
  agentId: string,
  challengerVersion: number,
): Promise<void> {
  // Mark the version with a shadow_queued_at timestamp so the cron can find it
  await systemQuery(
    `UPDATE agent_prompt_versions
     SET source = COALESCE(source, 'reflection'),
         updated_at = NOW()
     WHERE agent_id = $1 AND version = $2
       AND deployed_at IS NULL AND retired_at IS NULL`,
    [agentId, challengerVersion],
  );
  console.log(`[ShadowPromotion] Queued shadow evaluation for ${agentId} v${challengerVersion}`);
}

/**
 * Find all challenger prompt versions that are pending shadow evaluation:
 * not yet deployed, not retired, and with fewer than MIN_SHADOW_RUNS shadow runs.
 */
export async function getPendingChallengerVersions(): Promise<Array<{ agent_id: string; version: number }>> {
  const rows = await systemQuery<{ agent_id: string; version: number }>(
    `SELECT pv.agent_id, pv.version
     FROM agent_prompt_versions pv
     LEFT JOIN (
       SELECT agent_id, challenger_prompt_version, COUNT(*) AS run_count
       FROM shadow_runs
       WHERE status = 'evaluated'
       GROUP BY agent_id, challenger_prompt_version
     ) sr ON sr.agent_id = pv.agent_id AND sr.challenger_prompt_version = pv.version
     WHERE pv.deployed_at IS NULL
       AND pv.retired_at IS NULL
       AND COALESCE(sr.run_count, 0) < ${MIN_SHADOW_RUNS}
     ORDER BY pv.created_at ASC
     LIMIT 20`,
  );
  return rows;
}
