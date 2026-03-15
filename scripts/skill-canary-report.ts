import fs from 'node:fs';
import path from 'node:path';
import { systemQuery } from '@glyphor/shared/db';

interface CliArgs {
  agentRole: string;
  canaryStart?: string;
  canaryHours: number;
  baselineDays: number;
  outputPath?: string;
}

interface WindowMetrics {
  runCount: number;
  successRate: number;
  avgCost: number | null;
  avgTurns: number | null;
  avgQuality: number | null;
  stdQuality: number | null;
  avgConstitutional: number | null;
}

interface TrustWindow {
  startTrust: number | null;
  endTrust: number | null;
  delta: number | null;
}

interface CheckResult {
  metric: string;
  passed: boolean | null;
  detail: string;
}

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const agentRole = readArg(argv, '--agent-role') ?? readArg(argv, '--role');
  if (!agentRole) {
    throw new Error('Missing required --agent-role <role>.');
  }

  return {
    agentRole,
    canaryStart: readArg(argv, '--canary-start'),
    canaryHours: Number(readArg(argv, '--canary-hours') ?? '72'),
    baselineDays: Number(readArg(argv, '--baseline-days') ?? '7'),
    outputPath: readArg(argv, '--output'),
  };
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function iso(value: Date): string {
  return value.toISOString();
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null, digits = 3): string {
  return value == null ? 'n/a' : value.toFixed(digits);
}

async function queryWindowMetrics(agentRole: string, startIso: string, endIso: string): Promise<WindowMetrics> {
  const rows = await systemQuery<{
    run_count: number | string | null;
    success_rate: number | string | null;
    avg_cost: number | string | null;
    avg_turns: number | string | null;
    avg_quality: number | string | null;
    std_quality: number | string | null;
    avg_constitutional: number | string | null;
  }>(
    `WITH outcome_by_run AS (
       SELECT run_id, MAX(batch_quality_score) AS batch_quality_score
       FROM task_run_outcomes
       GROUP BY run_id
     ),
     const_by_run AS (
       SELECT run_id, MAX(overall_adherence) AS overall_adherence
       FROM constitutional_evaluations
       GROUP BY run_id
     )
     SELECT
       COUNT(*)::int AS run_count,
       COALESCE(AVG(CASE WHEN ar.status = 'completed' THEN 1.0 ELSE 0.0 END), 0)::float AS success_rate,
       AVG(ar.cost)::float AS avg_cost,
       AVG(ar.turns)::float AS avg_turns,
       AVG(obr.batch_quality_score)::float AS avg_quality,
       STDDEV_SAMP(obr.batch_quality_score)::float AS std_quality,
       AVG(cbr.overall_adherence)::float AS avg_constitutional
     FROM agent_runs ar
     LEFT JOIN outcome_by_run obr ON obr.run_id = ar.id
     LEFT JOIN const_by_run cbr ON cbr.run_id = ar.id
     WHERE ar.agent_id = $1
       AND ar.started_at >= $2::timestamptz
       AND ar.started_at < $3::timestamptz`,
    [agentRole, startIso, endIso],
  );

  const row = rows[0] ?? {
    run_count: 0,
    success_rate: 0,
    avg_cost: null,
    avg_turns: null,
    avg_quality: null,
    std_quality: null,
    avg_constitutional: null,
  };

  return {
    runCount: Number(row.run_count ?? 0),
    successRate: Number(row.success_rate ?? 0),
    avgCost: row.avg_cost == null ? null : Number(row.avg_cost),
    avgTurns: row.avg_turns == null ? null : Number(row.avg_turns),
    avgQuality: row.avg_quality == null ? null : Number(row.avg_quality),
    stdQuality: row.std_quality == null ? null : Number(row.std_quality),
    avgConstitutional: row.avg_constitutional == null ? null : Number(row.avg_constitutional),
  };
}

async function queryTrustWindow(agentRole: string, startIso: string, endIso: string): Promise<TrustWindow> {
  const rows = await systemQuery<{ trust_score: number | null; score_history: unknown }>(
    'SELECT trust_score, score_history FROM agent_trust_scores WHERE agent_role = $1 LIMIT 1',
    [agentRole],
  );

  const row = rows[0];
  if (!row) {
    return { startTrust: null, endTrust: null, delta: null };
  }

  const history = Array.isArray(row.score_history) ? row.score_history as Array<Record<string, unknown>> : [];
  const points = history
    .map((entry) => {
      const timestamp = typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : null;
      const score = typeof entry.score === 'number' ? entry.score : null;
      if (!timestamp || Number.isNaN(timestamp.getTime()) || score == null) return null;
      return { timestamp, score };
    })
    .filter((point): point is { timestamp: Date; score: number } => point != null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const startDate = asDate(startIso);
  const endDate = asDate(endIso);

  const startPoint = [...points].reverse().find((p) => p.timestamp <= startDate) ?? points[0] ?? null;
  const endPoint = [...points].reverse().find((p) => p.timestamp <= endDate) ?? null;

  const endTrust = endPoint?.score ?? row.trust_score ?? null;
  const startTrust = startPoint?.score ?? null;

  return {
    startTrust,
    endTrust,
    delta: startTrust != null && endTrust != null ? endTrust - startTrust : null,
  };
}

function evaluateChecks(baseline: WindowMetrics, canary: WindowMetrics, trust: TrustWindow): CheckResult[] {
  const qualityFloor =
    baseline.avgQuality != null
      ? baseline.avgQuality - 0.5 * (baseline.stdQuality ?? 0)
      : null;

  const checks: CheckResult[] = [
    {
      metric: 'Run success rate',
      passed: canary.successRate >= baseline.successRate,
      detail: `${pct(canary.successRate)} vs baseline ${pct(baseline.successRate)}`,
    },
    {
      metric: 'Quality score (batch eval)',
      passed:
        qualityFloor == null || canary.avgQuality == null
          ? null
          : canary.avgQuality >= qualityFloor,
      detail:
        qualityFloor == null || canary.avgQuality == null
          ? `insufficient data (canary=${num(canary.avgQuality)}, baseline=${num(baseline.avgQuality)})`
          : `${num(canary.avgQuality)} vs floor ${num(qualityFloor)}`,
    },
    {
      metric: 'Constitutional compliance',
      passed:
        baseline.avgConstitutional == null || canary.avgConstitutional == null
          ? null
          : canary.avgConstitutional >= baseline.avgConstitutional,
      detail:
        baseline.avgConstitutional == null || canary.avgConstitutional == null
          ? `insufficient data (canary=${num(canary.avgConstitutional)}, baseline=${num(baseline.avgConstitutional)})`
          : `${num(canary.avgConstitutional)} vs baseline ${num(baseline.avgConstitutional)}`,
    },
    {
      metric: 'Trust score delta',
      passed: trust.delta == null ? null : trust.delta >= -0.05,
      detail:
        trust.delta == null
          ? `insufficient data (start=${num(trust.startTrust)}, end=${num(trust.endTrust)})`
          : `${num(trust.delta)} (start=${num(trust.startTrust)} end=${num(trust.endTrust)})`,
    },
    {
      metric: 'Average run cost',
      passed:
        baseline.avgCost == null || canary.avgCost == null || baseline.avgCost <= 0
          ? null
          : canary.avgCost < baseline.avgCost * 1.5,
      detail:
        baseline.avgCost == null || canary.avgCost == null || baseline.avgCost <= 0
          ? `insufficient data (canary=${num(canary.avgCost)}, baseline=${num(baseline.avgCost)})`
          : `${num(canary.avgCost)} vs max ${num(baseline.avgCost * 1.5)}`,
    },
    {
      metric: 'Average turn count',
      passed:
        baseline.avgTurns == null || canary.avgTurns == null || baseline.avgTurns <= 0
          ? null
          : canary.avgTurns < baseline.avgTurns * 1.3,
      detail:
        baseline.avgTurns == null || canary.avgTurns == null || baseline.avgTurns <= 0
          ? `insufficient data (canary=${num(canary.avgTurns)}, baseline=${num(baseline.avgTurns)})`
          : `${num(canary.avgTurns)} vs max ${num(baseline.avgTurns * 1.3)}`,
    },
  ];

  return checks;
}

function printWindow(label: string, window: WindowMetrics): void {
  console.log(`\n[canary] ${label}`);
  console.log(`  runs: ${window.runCount}`);
  console.log(`  success_rate: ${pct(window.successRate)}`);
  console.log(`  avg_cost: ${num(window.avgCost)}`);
  console.log(`  avg_turns: ${num(window.avgTurns)}`);
  console.log(`  avg_quality: ${num(window.avgQuality)}`);
  console.log(`  std_quality: ${num(window.stdQuality)}`);
  console.log(`  avg_constitutional: ${num(window.avgConstitutional)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const canaryStart = args.canaryStart ? new Date(args.canaryStart) : new Date(Date.now() - args.canaryHours * 60 * 60 * 1000);
  if (Number.isNaN(canaryStart.getTime())) {
    throw new Error(`Invalid --canary-start value: ${args.canaryStart}`);
  }

  const canaryEnd = new Date(canaryStart.getTime() + args.canaryHours * 60 * 60 * 1000);
  const baselineStart = new Date(canaryStart.getTime() - args.baselineDays * 24 * 60 * 60 * 1000);

  const baseline = await queryWindowMetrics(args.agentRole, iso(baselineStart), iso(canaryStart));
  const canary = await queryWindowMetrics(args.agentRole, iso(canaryStart), iso(canaryEnd));
  const trust = await queryTrustWindow(args.agentRole, iso(canaryStart), iso(canaryEnd));

  printWindow('baseline', baseline);
  printWindow('canary', canary);

  console.log(`\n[canary] trust start=${num(trust.startTrust)} end=${num(trust.endTrust)} delta=${num(trust.delta)}`);

  const checks = evaluateChecks(baseline, canary, trust);
  console.log('\n[canary] pass/fail checks');
  for (const check of checks) {
    const status = check.passed == null ? 'N/A' : check.passed ? 'PASS' : 'FAIL';
    console.log(`- ${check.metric}: ${status} (${check.detail})`);
  }

  const hardFails = checks.filter((c) => c.passed === false);
  const overall = hardFails.length === 0 ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    agentRole: args.agentRole,
    windows: {
      baseline: { start: iso(baselineStart), end: iso(canaryStart), metrics: baseline },
      canary: { start: iso(canaryStart), end: iso(canaryEnd), metrics: canary },
    },
    trust,
    checks,
    overall,
  };

  const output = args.outputPath
    ? (path.isAbsolute(args.outputPath) ? args.outputPath : path.join(process.cwd(), args.outputPath))
    : path.join(
        process.cwd(),
        'artifacts',
        'skill-tests',
        `canary-${args.agentRole}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      );

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n[canary] overall=${overall}`);
  console.log(`[canary] report written: ${output}`);

  if (overall === 'FAIL') {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[canary] failed: ${message}`);
  process.exitCode = 1;
});
