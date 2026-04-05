/**
 * Layer 30 — Tool Execution Health
 *
 * Validates that tools actually work end-to-end by triggering the 3-tier
 * tool health check via the scheduler API and inspecting results from the DB.
 *
 * Tier 1: Schema validation — every tool has valid JSON schema
 * Tier 2: Connectivity — read-only tools return valid ToolResult (not throw)
 * Tier 3: Sandbox execution — destructive tools run against test fixtures
 *
 * Unlike Layer 16 (static factory checks) and Layer 18 (grant checks), this
 * layer validates that tools execute successfully in the deployed runtime.
 *
 * Run:
 *   npx ts-node packages/smoketest/src/main.ts --layer 30
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { runTest } from '../utils/test.js';
import { query } from '../utils/db.js';
import { httpPost, httpGet } from '../utils/http.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolHealthRunResponse {
  success: boolean;
  summary?: {
    testRunId: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    auth_failures: number;
    connection_failures: number;
    schema_failures: number;
    avg_response_ms: number;
    topFailures: Array<{ tool_name: string; error_type: string; error_message: string }>;
  };
  error?: string;
}

interface ToolTestResultRow {
  tool_name: string;
  risk_tier: string;
  test_strategy: string;
  status: string;
  response_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  schema_valid: boolean;
  connectivity_ok: boolean | null;
  execution_ok: boolean | null;
}

interface ToolTestRunRow {
  id: string;
  triggered_by: string;
  total_tools: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  started_at: string;
  completed_at: string | null;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum pass rate (%) for the full run to be considered healthy. */
const MIN_PASS_RATE = 75;
/** Max allowed auth failures before flagging secrets rotation issue. */
const MAX_AUTH_FAILURES = 5;
/** Max allowed connection failures before flagging infra issue. */
const MAX_CONNECTION_FAILURES = 3;
/** Max acceptable avg tool response time (ms). */
const MAX_AVG_RESPONSE_MS = 5000;
/** Max age (hours) for the latest run to be considered "fresh". */
const MAX_RUN_AGE_HOURS = 36;

// ─── Layer Runner ─────────────────────────────────────────────────────────────

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // ── T30.1 — Trigger a fresh tool health check ──────────────────────
  let runSummary: ToolHealthRunResponse['summary'] | null = null;

  tests.push(
    await runTest('T30.1', 'Trigger Tool Health Check (Tiers 1-2)', async () => {
      // Run tiers 1 + 2 only (tier 3 mutates data, skip in smoke test context)
      const resp = await httpPost<ToolHealthRunResponse>(
        `${config.schedulerUrl}/tool-health/run`,
        { tiers: [1, 2], triggeredBy: 'smoketest' },
        120_000, // 2-minute timeout — tier 2 probes all tools
      );

      if (!resp.ok || !resp.data.success || !resp.data.summary) {
        throw new Error(
          `Tool health check failed: ${resp.data.error ?? `HTTP ${resp.status}`}`,
        );
      }

      runSummary = resp.data.summary;
      const s = runSummary;
      return (
        `Run ${s.testRunId}: ${s.total} tools tested, ` +
        `${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped, ` +
        `avg ${Math.round(s.avg_response_ms ?? 0)}ms`
      );
    }),
  );

  // ── T30.2 — Pass rate above threshold ──────────────────────────────
  tests.push(
    await runTest('T30.2', `Pass Rate ≥ ${MIN_PASS_RATE}%`, async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      const tested = runSummary.passed + runSummary.failed;
      if (tested === 0) throw new Error('No tools were tested');
      const rate = Math.round((runSummary.passed / tested) * 100);
      if (rate < MIN_PASS_RATE) {
        throw new Error(
          `Pass rate ${rate}% < ${MIN_PASS_RATE}% threshold ` +
          `(${runSummary.passed}/${tested} passed)`,
        );
      }
      return `${rate}% pass rate (${runSummary.passed}/${tested})`;
    }),
  );

  // ── T30.3 — No excessive auth failures ─────────────────────────────
  tests.push(
    await runTest('T30.3', `Auth Failures ≤ ${MAX_AUTH_FAILURES}`, async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      if (runSummary.auth_failures > MAX_AUTH_FAILURES) {
        // Pull details from DB
        const authFailures = await query<ToolTestResultRow>(
          `SELECT tool_name, error_message FROM tool_test_results
           WHERE test_run_id = $1 AND error_type = 'auth' AND status = 'fail'
           ORDER BY tool_name LIMIT 10`,
          [runSummary.testRunId],
        );
        const names = authFailures.map(f => f.tool_name).join(', ');
        throw new Error(
          `${runSummary.auth_failures} auth failures (max ${MAX_AUTH_FAILURES}). ` +
          `Check API keys/secrets for: ${names}`,
        );
      }
      return `${runSummary.auth_failures} auth failures (within threshold)`;
    }),
  );

  // ── T30.4 — No excessive connection failures ──────────────────────
  tests.push(
    await runTest('T30.4', `Connection Failures ≤ ${MAX_CONNECTION_FAILURES}`, async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      if (runSummary.connection_failures > MAX_CONNECTION_FAILURES) {
        const connFailures = await query<ToolTestResultRow>(
          `SELECT tool_name, error_message FROM tool_test_results
           WHERE test_run_id = $1 AND error_type = 'connection' AND status = 'fail'
           ORDER BY tool_name LIMIT 10`,
          [runSummary.testRunId],
        );
        const names = connFailures.map(f => f.tool_name).join(', ');
        throw new Error(
          `${runSummary.connection_failures} connection failures (max ${MAX_CONNECTION_FAILURES}). ` +
          `Unreachable: ${names}`,
        );
      }
      return `${runSummary.connection_failures} connection failures (within threshold)`;
    }),
  );

  // ── T30.5 — No schema validation failures ─────────────────────────
  tests.push(
    await runTest('T30.5', 'Zero Schema Failures', async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      if (runSummary.schema_failures > 0) {
        const schemaFails = await query<ToolTestResultRow>(
          `SELECT tool_name, error_message FROM tool_test_results
           WHERE test_run_id = $1 AND schema_valid = false AND status = 'fail'
           ORDER BY tool_name LIMIT 10`,
          [runSummary.testRunId],
        );
        const details = schemaFails
          .map(f => `${f.tool_name}: ${f.error_message}`)
          .join('; ');
        throw new Error(
          `${runSummary.schema_failures} schema failures: ${details}`,
        );
      }
      return `0 schema failures — all tool schemas valid`;
    }),
  );

  // ── T30.6 — Avg response time acceptable ──────────────────────────
  tests.push(
    await runTest('T30.6', `Avg Response ≤ ${MAX_AVG_RESPONSE_MS}ms`, async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      const avg = Math.round(runSummary.avg_response_ms ?? 0);
      if (avg > MAX_AVG_RESPONSE_MS) {
        // Find the slowest tools
        const slowest = await query<{ tool_name: string; response_ms: number }>(
          `SELECT tool_name, response_ms FROM tool_test_results
           WHERE test_run_id = $1 AND response_ms IS NOT NULL
           ORDER BY response_ms DESC LIMIT 5`,
          [runSummary.testRunId],
        );
        const details = slowest
          .map(t => `${t.tool_name} (${t.response_ms}ms)`)
          .join(', ');
        throw new Error(
          `Avg response ${avg}ms > ${MAX_AVG_RESPONSE_MS}ms. Slowest: ${details}`,
        );
      }
      return `Avg response ${avg}ms`;
    }),
  );

  // ── T30.7 — Top failures analysis ─────────────────────────────────
  tests.push(
    await runTest('T30.7', 'Top Failures Analysis', async () => {
      if (!runSummary) throw new Error('No run summary — T30.1 must pass first');
      const failures = runSummary.topFailures;
      if (failures.length === 0) {
        return 'No failures to analyze';
      }

      // Group by error type
      const byType: Record<string, string[]> = {};
      for (const f of failures) {
        const type = f.error_type || 'unknown';
        if (!byType[type]) byType[type] = [];
        byType[type].push(f.tool_name);
      }

      const analysis = Object.entries(byType)
        .map(([type, tools]) => `${type}: ${tools.length} (${tools.slice(0, 3).join(', ')}${tools.length > 3 ? '...' : ''})`)
        .join('; ');

      // This test always passes — it's informational. The thresholds above
      // are what gate pass/fail.
      return `${failures.length} failures: ${analysis}`;
    }),
  );

  // ── T30.8 — Cron freshness: last scheduled run exists and is recent ─
  tests.push(
    await runTest('T30.8', 'Last Scheduled Run Freshness', async () => {
      const runs = await query<ToolTestRunRow>(
        `SELECT id, triggered_by, total_tools, passed, failed, skipped, errors,
                started_at, completed_at
         FROM tool_test_runs
         WHERE triggered_by = 'scheduled'
         ORDER BY started_at DESC LIMIT 1`,
      );

      if (runs.length === 0) {
        throw new Error(
          'No scheduled tool health runs found. ' +
          'Check that the tool-health-check cron job is enabled in Cloud Scheduler.',
        );
      }

      const run = runs[0];
      const ageMs = Date.now() - new Date(run.started_at).getTime();
      const ageHours = Math.round(ageMs / (1000 * 60 * 60));

      if (ageHours > MAX_RUN_AGE_HOURS) {
        throw new Error(
          `Last scheduled run was ${ageHours}h ago (threshold: ${MAX_RUN_AGE_HOURS}h). ` +
          `Run ID: ${run.id}, started: ${run.started_at}`,
        );
      }

      const passRate = run.passed + run.failed > 0
        ? Math.round((run.passed / (run.passed + run.failed)) * 100)
        : 0;

      return (
        `Last scheduled run: ${ageHours}h ago, ` +
        `${run.total_tools} tools, ${passRate}% pass rate ` +
        `(${run.passed}P/${run.failed}F/${run.skipped}S)`
      );
    }),
  );

  // ── T30.9 — Failure trend: no regression vs last 3 runs ───────────
  tests.push(
    await runTest('T30.9', 'No Failure Regression (Last 3 Runs)', async () => {
      const recentRuns = await query<ToolTestRunRow>(
        `SELECT id, passed, failed, started_at, completed_at
         FROM tool_test_runs
         WHERE completed_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 4`, // current + 3 prior
      );

      if (recentRuns.length < 2) {
        return 'Not enough historical runs to detect regression (< 2 runs)';
      }

      const [latest, ...prior] = recentRuns;
      const latestFailRate = latest.failed / Math.max(1, latest.passed + latest.failed);
      const priorAvgFailRate =
        prior.reduce((s, r) => s + r.failed / Math.max(1, r.passed + r.failed), 0) / prior.length;

      // Allow 10% absolute increase before flagging
      if (latestFailRate > priorAvgFailRate + 0.10) {
        const latestPct = Math.round(latestFailRate * 100);
        const priorPct = Math.round(priorAvgFailRate * 100);
        throw new Error(
          `Failure rate regression: latest ${latestPct}% vs prior avg ${priorPct}% ` +
          `(+${latestPct - priorPct}pp). Investigate new failures.`,
        );
      }

      const latestPct = Math.round(latestFailRate * 100);
      const priorPct = Math.round(priorAvgFailRate * 100);
      return `No regression: latest ${latestPct}% fail rate vs prior avg ${priorPct}%`;
    }),
  );

  return {
    layer: 30,
    name: 'Tool Execution Health',
    tests,
  };
}
