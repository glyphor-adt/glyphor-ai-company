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
 * Inserts placeholder rows that the scheduler picks up and executes.
 */
export async function queueShadowEvaluation(
  agentId: string,
  challengerVersion: number,
): Promise<void> {
  console.log(`[ShadowPromotion] Queued shadow evaluation for ${agentId} v${challengerVersion}`);
  // The scheduler's shadow-eval loop will pick up unevaluated versions
  // by checking agent_prompt_versions where deployed_at IS NULL AND retired_at IS NULL
}
