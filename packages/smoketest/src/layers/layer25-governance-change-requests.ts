/**
 * Layer 25 — Governance & Change Request Control Plane
 *
 * Validates the scheduler's governance API surface and the dashboard change
 * request pipeline tables/endpoints so architecture coverage includes the
 * governance control plane and GitHub-backed request flow.
 */

import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { query } from '../utils/db.js';
import { httpGet } from '../utils/http.js';
import { runTest } from '../utils/test.js';

const GOVERNANCE_RESOURCES = [
  'action-queue',
  'changelog',
  'risk-summary',
  'trust-map',
  'least-privilege',
  'least-privilege-analysis',
  'access-posture',
] as const;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasNumericField(obj: Record<string, unknown> | null, field: string): boolean {
  return !!obj && typeof obj[field] === 'number' && Number.isFinite(obj[field] as number);
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  tests.push(
    await runTest('T25.1', 'Governance API Resources Reachable', async () => {
      const failures: string[] = [];

      for (const resource of GOVERNANCE_RESOURCES) {
        const res = await httpGet(`${config.schedulerUrl}/api/governance/${resource}`);
        if (!res.ok) {
          failures.push(`${resource}: HTTP ${res.status}`);
          continue;
        }

        const data = res.data;
        if (data == null) {
          failures.push(`${resource}: empty JSON response`);
          continue;
        }
      }

      if (failures.length > 0) {
        throw new Error(`Governance API failures: ${failures.join('; ')}`);
      }

      return `${GOVERNANCE_RESOURCES.length} governance resources returned JSON successfully`;
    }),
  );

  tests.push(
    await runTest('T25.2', 'Governance API Has Meaningful Payloads', async () => {
      const risk = await httpGet<Record<string, unknown>>(`${config.schedulerUrl}/api/governance/risk-summary`);
      const trust = await httpGet<unknown[]>(`${config.schedulerUrl}/api/governance/trust-map`);
      const access = await httpGet<Record<string, unknown>>(`${config.schedulerUrl}/api/governance/access-posture`);

      if (!risk.ok || !trust.ok || !access.ok) {
        throw new Error(`risk=${risk.status}, trust=${trust.status}, access=${access.status}`);
      }

      const riskBody = asObject(risk.data);
      const accessBody = asObject(access.data);
      const trustRows = Array.isArray(trust.data) ? trust.data : [];

      const trustAlerts = asObject(riskBody?.trust_alerts);
      const driftAlerts = asObject(riskBody?.drift_alerts);
      const accessRisk = asObject(riskBody?.access_risk);
      const policyHealth = asObject(riskBody?.policy_health);
      const compliance = asObject(riskBody?.compliance);

      const hasMeaningfulRiskPayload =
        hasNumericField(trustAlerts, 'count')
        && hasNumericField(driftAlerts, 'count')
        && hasNumericField(accessRisk, 'count')
        && (hasNumericField(policyHealth, 'avg_eval_score') || policyHealth?.avg_eval_score === null)
        && (hasNumericField(compliance, 'pass_rate') || compliance?.pass_rate === null);

      if (!hasMeaningfulRiskPayload) {
        throw new Error('risk-summary missing expected governance metrics');
      }
      if (!accessBody || typeof accessBody.score !== 'number') {
        throw new Error('access-posture missing numeric score');
      }
      if (trustRows.length === 0) {
        return '⚠ trust-map returned zero entries; endpoint is healthy but there is no trust-map data yet';
      }

      return `risk-trust=${trustAlerts?.count}, risk-drift=${driftAlerts?.count}, access-score=${accessBody.score}, trust-entries=${trustRows.length}`;
    }),
  );

  tests.push(
    await runTest('T25.3', 'Dashboard Change Requests API Reachable', async () => {
      const res = await httpGet<unknown[]>(`${config.schedulerUrl}/api/dashboard-change-requests?limit=5`);
      if (!res.ok) {
        throw new Error(`/api/dashboard-change-requests returned HTTP ${res.status}`);
      }
      if (!Array.isArray(res.data)) {
        throw new Error('dashboard-change-requests response is not an array');
      }
      return `dashboard-change-requests API returned ${res.data.length} row(s)`;
    }),
  );

  tests.push(
    await runTest('T25.4', 'Change Request Pipeline Schema Present', async () => {
      const rows = await query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'dashboard_change_requests'`,
      );
      const actual = new Set(rows.map((row) => row.column_name));
      const required = [
        'status',
        'assigned_to',
        'github_issue_number',
        'github_issue_url',
        'github_branch',
        'github_pr_url',
        'commit_sha',
        'agent_notes',
        'started_at',
        'completed_at',
      ];
      const missing = required.filter((column) => !actual.has(column));
      if (missing.length > 0) {
        throw new Error(`dashboard_change_requests missing columns: ${missing.join(', ')}`);
      }
      return `dashboard_change_requests includes ${required.length} pipeline columns`;
    }),
  );

  tests.push(
    await runTest('T25.5', 'Governance Tables Queryable', async () => {
      const rows = await Promise.all([
        query<{ count: number }>('SELECT COUNT(*)::int AS count FROM platform_iam_state'),
        query<{ count: number }>('SELECT COUNT(*)::int AS count FROM platform_audit_log'),
        query<{ count: number }>('SELECT COUNT(*)::int AS count FROM platform_secret_rotation'),
      ]);

      const iam = rows[0][0]?.count ?? 0;
      const audit = rows[1][0]?.count ?? 0;
      const secrets = rows[2][0]?.count ?? 0;
      return `platform_iam_state=${iam}, platform_audit_log=${audit}, platform_secret_rotation=${secrets}`;
    }),
  );

  return { layer: 25, name: 'Governance & Change Requests', tests };
}
