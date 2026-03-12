/**
 * Canary Evaluator — Executive orchestration rollout evaluation
 *
 * Runs weekly (0 8 * * 1 — Monday 8 AM UTC) to compare executive
 * orchestration quality against Sarah (chief-of-staff) baseline.
 *
 * Uses the delegation_performance materialized view for side-by-side
 * statistical comparison. No LLM calls — pure metrics evaluation.
 *
 * Verdicts:
 *  - expand   → enable next executive in rollout order
 *  - continue → insufficient data or inconclusive, wait another week
 *  - revert   → regression detected, disable canary executive
 */

import { systemQuery } from '@glyphor/shared/db';
import { GlyphorEventBus } from '@glyphor/agent-runtime';
import type { GlyphorEventType } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface MetricSet {
  first_time_accept_rate: number;
  revision_rate: number;
  failure_rate: number;
  avg_quality: number;
  avg_cost: number;
  avg_turns: number;
}

export interface CanaryEvaluation {
  verdict: 'expand' | 'continue' | 'revert';
  metrics: {
    sarah: MetricSet;
    executive: MetricSet;
  };
  sample_sizes: { sarah: number; executive: number };
  days_elapsed: number;
  recommendation: string;
}

interface DelegationRow {
  orchestrator_type: string;
  total_assignments: number;
  first_time_accept_rate: number | null;
  revision_rate: number | null;
  failure_rate: number | null;
  avg_quality: number | null;
  avg_cost: number | null;
  avg_turns: number | null;
}

interface CanaryConfig {
  executive_role: string;
  is_canary: boolean;
  canary_started_at: string | null;
  can_decompose: boolean;
}

// ─── Configuration ──────────────────────────────────────────────

const LOG_PREFIX = '[CanaryEvaluator]';

const MIN_SAMPLE_SIZE = 20;
const MIN_DAYS_FOR_EXPANSION = 14;

// Primary metric thresholds (first_time_accept_rate)
const PRIMARY_PASS_TOLERANCE = 0.05;    // exec >= sarah - 0.05
const PRIMARY_FAIL_THRESHOLD = 0.15;    // exec < sarah - 0.15

// Secondary metric regression limits
const SECONDARY_RATE_LIMIT = 1.2;       // revision_rate, failure_rate: exec <= sarah * 1.2
const SECONDARY_QUALITY_LIMIT = 0.8;    // avg_quality: exec >= sarah * 0.8
const SECONDARY_COST_LIMIT = 1.5;       // avg_cost: exec <= sarah * 1.5

// Expansion order — executives enabled one at a time after canary passes
const EXPANSION_ORDER = [
  'cto',                   // Already canary
  'cmo',                   // Large team, content is domain-specific
  'cpo',                   // Product requires domain judgment
  'cfo',                   // Financial analysis requires precision
  'vp-sales',              // Sales research is specialized
  'vp-design',
  'vp-research',
];

// ─── Main Entry Point ───────────────────────────────────────────

export async function evaluateCanary(eventBus?: GlyphorEventBus): Promise<CanaryEvaluation> {
  // Refresh the materialized view
  try {
    await systemQuery('SELECT refresh_delegation_metrics()', []);
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to refresh delegation_performance:`, (err as Error).message);
    // Continue with potentially stale data rather than failing entirely
  }

  // Query delegation_performance for comparison data
  const rows = await systemQuery<DelegationRow>(
    `SELECT orchestrator_type, total_assignments,
            first_time_accept_rate, revision_rate, failure_rate,
            avg_quality, avg_cost, avg_turns
     FROM delegation_performance`,
    [],
  );

  const sarahRow = rows.find(r => r.orchestrator_type === 'sarah');
  const execRow = rows.find(r => r.orchestrator_type === 'executive');

  const sarahMetrics = toMetricSet(sarahRow);
  const execMetrics = toMetricSet(execRow);
  const sarahCount = sarahRow?.total_assignments ?? 0;
  const execCount = execRow?.total_assignments ?? 0;

  // Calculate days elapsed since earliest canary started
  const daysElapsed = await getCanaryDaysElapsed();

  // Insufficient data check
  if (sarahCount < MIN_SAMPLE_SIZE || execCount < MIN_SAMPLE_SIZE) {
    const evaluation: CanaryEvaluation = {
      verdict: 'continue',
      metrics: { sarah: sarahMetrics, executive: execMetrics },
      sample_sizes: { sarah: sarahCount, executive: execCount },
      days_elapsed: daysElapsed,
      recommendation: `Insufficient data: sarah=${sarahCount}, executive=${execCount} (need ${MIN_SAMPLE_SIZE} each)`,
    };

    await logActivity('canary.evaluation', evaluation.recommendation);
    console.log(`${LOG_PREFIX} ${evaluation.recommendation}`);
    return evaluation;
  }

  // Evaluate primary metric: first_time_accept_rate
  const primaryResult = evaluatePrimary(sarahMetrics, execMetrics);

  // Evaluate secondary metrics
  const secondaryResults = evaluateSecondary(sarahMetrics, execMetrics);
  const allSecondaryPass = secondaryResults.every(r => r.pass);
  const anySecondaryHardFail = secondaryResults.some(r => r.hardFail);

  // Determine verdict
  let verdict: CanaryEvaluation['verdict'];
  let recommendation: string;

  if (primaryResult === 'FAIL' || anySecondaryHardFail) {
    verdict = 'revert';
    const failedSecondary = secondaryResults.filter(r => r.hardFail).map(r => r.name);
    recommendation = primaryResult === 'FAIL'
      ? `Primary metric FAIL: exec first_time_accept_rate=${execMetrics.first_time_accept_rate.toFixed(3)} < sarah=${sarahMetrics.first_time_accept_rate.toFixed(3)} - ${PRIMARY_FAIL_THRESHOLD}`
      : `Secondary metrics hard fail: ${failedSecondary.join(', ')}`;
  } else if (
    primaryResult === 'PASS' &&
    allSecondaryPass &&
    execCount >= MIN_SAMPLE_SIZE &&
    daysElapsed >= MIN_DAYS_FOR_EXPANSION
  ) {
    verdict = 'expand';
    recommendation = `All metrics pass after ${daysElapsed} days with ${execCount} executive assignments. Ready for expansion.`;
  } else {
    verdict = 'continue';
    const reasons: string[] = [];
    if (primaryResult === 'INCONCLUSIVE') reasons.push('primary metric inconclusive');
    if (!allSecondaryPass) {
      const softFails = secondaryResults.filter(r => !r.pass).map(r => r.name);
      reasons.push(`secondary soft-fails: ${softFails.join(', ')}`);
    }
    if (daysElapsed < MIN_DAYS_FOR_EXPANSION) reasons.push(`only ${daysElapsed}/${MIN_DAYS_FOR_EXPANSION} days elapsed`);
    recommendation = `Continue monitoring: ${reasons.join('; ')}`;
  }

  const evaluation: CanaryEvaluation = {
    verdict,
    metrics: { sarah: sarahMetrics, executive: execMetrics },
    sample_sizes: { sarah: sarahCount, executive: execCount },
    days_elapsed: daysElapsed,
    recommendation,
  };

  // Execute verdict actions
  if (verdict === 'expand') {
    await handleExpansion(evaluation, eventBus);
  } else if (verdict === 'revert') {
    await handleRevert(evaluation, eventBus);
  }

  // Log and emit results
  await logActivity('canary.evaluation', `Verdict: ${verdict} — ${recommendation}`);
  await emitEvent(eventBus, verdict, evaluation);

  console.log(`${LOG_PREFIX} Verdict: ${verdict} — ${recommendation}`);
  return evaluation;
}

// ─── Metric Evaluation ─────────────────────────────────────────

function toMetricSet(row: DelegationRow | undefined): MetricSet {
  return {
    first_time_accept_rate: row?.first_time_accept_rate ?? 0,
    revision_rate: row?.revision_rate ?? 0,
    failure_rate: row?.failure_rate ?? 0,
    avg_quality: row?.avg_quality ?? 0,
    avg_cost: row?.avg_cost ?? 0,
    avg_turns: row?.avg_turns ?? 0,
  };
}

function evaluatePrimary(sarah: MetricSet, exec: MetricSet): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  if (exec.first_time_accept_rate >= sarah.first_time_accept_rate - PRIMARY_PASS_TOLERANCE) {
    return 'PASS';
  }
  if (exec.first_time_accept_rate < sarah.first_time_accept_rate - PRIMARY_FAIL_THRESHOLD) {
    return 'FAIL';
  }
  return 'INCONCLUSIVE';
}

interface SecondaryResult {
  name: string;
  pass: boolean;
  hardFail: boolean;
}

function evaluateSecondary(sarah: MetricSet, exec: MetricSet): SecondaryResult[] {
  return [
    {
      name: 'revision_rate',
      pass: exec.revision_rate <= sarah.revision_rate * SECONDARY_RATE_LIMIT,
      hardFail: exec.revision_rate > sarah.revision_rate * SECONDARY_RATE_LIMIT,
    },
    {
      name: 'failure_rate',
      pass: exec.failure_rate <= sarah.failure_rate * SECONDARY_RATE_LIMIT,
      hardFail: exec.failure_rate > sarah.failure_rate * SECONDARY_RATE_LIMIT,
    },
    {
      name: 'avg_quality',
      pass: exec.avg_quality >= sarah.avg_quality * SECONDARY_QUALITY_LIMIT,
      hardFail: exec.avg_quality < sarah.avg_quality * SECONDARY_QUALITY_LIMIT,
    },
    {
      name: 'avg_cost',
      pass: exec.avg_cost <= sarah.avg_cost * SECONDARY_COST_LIMIT,
      hardFail: exec.avg_cost > sarah.avg_cost * SECONDARY_COST_LIMIT,
    },
  ];
}

// ─── Expansion Logic ────────────────────────────────────────────

async function handleExpansion(evaluation: CanaryEvaluation, eventBus?: GlyphorEventBus): Promise<void> {
  // Find currently enabled executives
  const enabled = await systemQuery<CanaryConfig>(
    `SELECT executive_role, is_canary, canary_started_at, can_decompose
     FROM executive_orchestration_config
     WHERE can_decompose = true`,
    [],
  );
  const enabledRoles = new Set(enabled.map(e => e.executive_role));

  // Find the next executive in expansion order that isn't enabled yet
  const nextRole = EXPANSION_ORDER.find(role => !enabledRoles.has(role));
  if (!nextRole) {
    console.log(`${LOG_PREFIX} All executives already enabled — no expansion needed`);
    return;
  }

  // Enable the next executive as a canary
  await systemQuery(
    `INSERT INTO executive_orchestration_config
       (executive_role, can_decompose, can_evaluate, is_canary, canary_started_at, allowed_assignees)
     VALUES ($1, true, true, true, NOW(), '{}')
     ON CONFLICT (executive_role) DO UPDATE SET
       can_decompose = true, can_evaluate = true,
       is_canary = true, canary_started_at = NOW(),
       updated_at = NOW()`,
    [nextRole],
  );

  // Create a Yellow-tier decision for founder approval
  await systemQuery(
    `INSERT INTO pending_decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to, created_at)
     VALUES ('yellow', 'pending', $1, $2, 'chief-of-staff', $3, ARRAY['kristina', 'andrew'], NOW())`,
    [
      `Enable ${nextRole} for executive orchestration`,
      `Canary evaluation passed for executive orchestration. Recommending expansion to ${nextRole}. `
        + `Executive first_time_accept_rate: ${evaluation.metrics.executive.first_time_accept_rate.toFixed(3)}, `
        + `Sarah baseline: ${evaluation.metrics.sarah.first_time_accept_rate.toFixed(3)}. `
        + `${evaluation.sample_sizes.executive} executive assignments over ${evaluation.days_elapsed} days.`,
      evaluation.recommendation,
    ],
  );

  await logActivity(
    'canary.expansion',
    `Executive orchestration expanded to ${nextRole} (pending founder approval). `
      + `Metrics: exec_accept=${evaluation.metrics.executive.first_time_accept_rate.toFixed(3)}, `
      + `sarah_accept=${evaluation.metrics.sarah.first_time_accept_rate.toFixed(3)}`,
  );
}

// ─── Revert Logic ───────────────────────────────────────────────

async function handleRevert(evaluation: CanaryEvaluation, eventBus?: GlyphorEventBus): Promise<void> {
  // Disable canary executives but don't disrupt in-progress delegated directives
  await systemQuery(
    `UPDATE executive_orchestration_config
     SET can_decompose = false, is_canary = false, updated_at = NOW()
     WHERE is_canary = true`,
    [],
  );

  await logActivity(
    'canary.revert',
    `Executive orchestration canary reverted due to regression. `
      + `Exec accept_rate=${evaluation.metrics.executive.first_time_accept_rate.toFixed(3)}, `
      + `Sarah accept_rate=${evaluation.metrics.sarah.first_time_accept_rate.toFixed(3)}. `
      + `Reason: ${evaluation.recommendation}`,
  );
}

// ─── Helpers ────────────────────────────────────────────────────

async function getCanaryDaysElapsed(): Promise<number> {
  try {
    const rows = await systemQuery<{ days: number }>(
      `SELECT EXTRACT(DAY FROM NOW() - MIN(canary_started_at))::int AS days
       FROM executive_orchestration_config
       WHERE is_canary = true AND canary_started_at IS NOT NULL`,
      [],
    );
    return rows[0]?.days ?? 0;
  } catch {
    return 0;
  }
}

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

async function emitEvent(
  eventBus: GlyphorEventBus | undefined,
  verdict: CanaryEvaluation['verdict'],
  evaluation: CanaryEvaluation,
): Promise<void> {
  if (!eventBus) return;
  const eventType: GlyphorEventType = verdict === 'revert' ? 'alert.triggered' : 'insight.detected';
  try {
    await eventBus.emit({
      type: eventType,
      source: 'system',
      payload: {
        action: `canary.evaluation.${verdict}`,
        verdict,
        recommendation: evaluation.recommendation,
        sample_sizes: evaluation.sample_sizes,
        days_elapsed: evaluation.days_elapsed,
        exec_accept_rate: evaluation.metrics.executive.first_time_accept_rate,
        sarah_accept_rate: evaluation.metrics.sarah.first_time_accept_rate,
      },
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} Event emission failed:`, (err as Error).message);
  }
}
