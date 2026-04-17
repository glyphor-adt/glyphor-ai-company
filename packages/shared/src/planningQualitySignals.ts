import { systemQuery } from './db.js';

/** Minimum planned runs before gate pass rate influences the autonomy composite. */
export const AUTONOMY_GATE_MIN_RUNS = 3;
/** Minimum golden eval rows before golden pass rate influences the composite. */
export const AUTONOMY_GOLDEN_MIN_RESULTS = 2;

export interface RolePlanningQualitySnapshot {
  gatePassRate: number;
  /** Denominator used for gate pass rate (runs with planning, else runs observed). */
  gatePassDenominator: number;
  runsObserved: number;
}

export interface GoldenEvalRoleRate {
  agentRole: string;
  total: number;
  passed: number;
  passRate: number;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

/**
 * Per-role completion-gate pass rate over the window (same semantics as planning-gate dashboard).
 */
export async function loadRolePlanningQuality(
  agentRole: string,
  windowDays: number,
): Promise<RolePlanningQualitySnapshot> {
  const rows = await systemQuery<{
    runs_observed: number;
    runs_with_planning: number;
    runs_with_gate_pass: number;
  }>(
    `WITH run_flags AS (
       SELECT
         e.run_id,
         BOOL_OR(e.event_type = 'planning_phase_started') AS has_planning,
         BOOL_OR(e.event_type = 'completion_gate_passed') AS has_pass
       FROM agent_run_events e
       INNER JOIN agent_runs ar ON ar.id = e.run_id
       WHERE ar.agent_id = $1
         AND e.created_at >= NOW() - (CAST($2 AS int) * INTERVAL '1 day')
         AND e.event_type IN ('planning_phase_started', 'completion_gate_failed', 'completion_gate_passed')
       GROUP BY e.run_id
     )
     SELECT
       COUNT(*)::int AS runs_observed,
       COUNT(*) FILTER (WHERE has_planning)::int AS runs_with_planning,
       COUNT(*) FILTER (WHERE has_pass)::int AS runs_with_gate_pass
     FROM run_flags`,
    [agentRole, windowDays],
  );

  const row = rows[0] ?? { runs_observed: 0, runs_with_planning: 0, runs_with_gate_pass: 0 };
  const runsObserved = row.runs_observed ?? 0;
  const runsWithPlanning = row.runs_with_planning ?? 0;
  const runsWithGatePass = row.runs_with_gate_pass ?? 0;
  const denominator = runsWithPlanning > 0 ? runsWithPlanning : runsObserved;
  const gatePassRate = denominator > 0 ? runsWithGatePass / denominator : 0;

  return {
    gatePassRate: round(gatePassRate),
    gatePassDenominator: denominator,
    runsObserved,
  };
}

export async function loadRoleGoldenEvalPassRate(
  agentRole: string,
  windowDays: number,
): Promise<{ passRate: number; total: number; passed: number }> {
  const rows = await systemQuery<{ total: number; passed: number }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
     FROM agent_eval_results r
     INNER JOIN agent_eval_scenarios s ON s.id = r.scenario_id
     WHERE r.agent_role = $1
       AND r.run_date >= NOW() - (CAST($2 AS int) * INTERVAL '1 day')
       AND s.scenario_name ILIKE 'golden:%'`,
    [agentRole, windowDays],
  );

  const total = Number(rows[0]?.total ?? 0);
  const passed = Number(rows[0]?.passed ?? 0);
  const passRate = total > 0 ? passed / total : 0;
  return { passRate: round(passRate), total, passed };
}

/**
 * Fleet-wide golden eval pass rates by agent role (scenarios named `golden:%`).
 */
export async function listGoldenEvalPassRatesByRole(windowDays: number): Promise<GoldenEvalRoleRate[]> {
  const rows = await systemQuery<{ agent_role: string; total: number; passed: number }>(
    `SELECT
       r.agent_role,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE r.score = 'PASS')::int AS passed
     FROM agent_eval_results r
     INNER JOIN agent_eval_scenarios s ON s.id = r.scenario_id
     WHERE r.run_date >= NOW() - (CAST($1 AS int) * INTERVAL '1 day')
       AND s.scenario_name ILIKE 'golden:%'
     GROUP BY r.agent_role
     ORDER BY total DESC, r.agent_role ASC`,
    [windowDays],
  );

  return rows.map((row) => {
    const total = Number(row.total ?? 0);
    const passed = Number(row.passed ?? 0);
    return {
      agentRole: row.agent_role,
      total,
      passed,
      passRate: total > 0 ? round(passed / total) : 0,
    };
  });
}

/**
 * Blend trust, completion-gate pass rate, and golden eval pass rate for autonomy promotion guardrails.
 * Missing gate or golden samples drop that term and renormalize weights onto the remaining signals.
 */
export function computeAutonomyCompositeScore(input: {
  trustScore: number;
  gateRate: number;
  gateDenominator: number;
  goldenRate: number;
  goldenTotal: number;
}): number {
  let wTrust = 0.45;
  let wGate = 0.35;
  let wGolden = 0.2;

  if (input.gateDenominator < AUTONOMY_GATE_MIN_RUNS) {
    wGate = 0;
  }
  if (input.goldenTotal < AUTONOMY_GOLDEN_MIN_RESULTS) {
    wGolden = 0;
  }

  const wSum = wTrust + wGate + wGolden;
  if (wSum <= 0) {
    return round(Math.max(0, Math.min(1, input.trustScore)));
  }

  let score = (wTrust / wSum) * input.trustScore;
  if (wGate > 0) score += (wGate / wSum) * input.gateRate;
  if (wGolden > 0) score += (wGolden / wSum) * input.goldenRate;

  return round(Math.max(0, Math.min(1, score)));
}

/** Maps composite score to a maximum autonomy level (0–4) before threshold rows are applied. */
export function compositeCeilingAutonomyLevel(composite: number): number {
  if (composite >= 0.78) return 4;
  if (composite >= 0.62) return 3;
  if (composite >= 0.48) return 2;
  if (composite >= 0.32) return 1;
  return 0;
}
