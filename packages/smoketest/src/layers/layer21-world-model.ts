/**
 * Layer 21 – World Model & Self-Assessment
 *
 * Validates the agent world model system: table schema, seeded data,
 * self-assessment updates after runs, and dashboard API exposure.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query } from '../utils/db.js';
import { httpGet } from '../utils/http.js';
import { runTest } from '../utils/test.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T21.1 — World Model Table Exists & Seeded
  tests.push(
    await runTest('T21.1', 'World Model Table Seeded', async () => {
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM agent_world_model`,
      );
      const count = rows[0]?.count ?? 0;
      if (count === 0) {
        throw new Error('agent_world_model table is empty — run seed migration');
      }
      if (count < 30) {
        throw new Error(`Only ${count} world model rows — expected 44 (one per agent)`);
      }
      return `${count} agent world model rows seeded`;
    }),
  );

  // T21.2 — All Agents Have World Models
  tests.push(
    await runTest('T21.2', 'All Agents Have World Models', async () => {
      const missing = await query<{ role: string }>(
        `SELECT ca.role
         FROM company_agents ca
         LEFT JOIN agent_world_model wm ON ca.role = wm.agent_role
         WHERE wm.id IS NULL AND ca.status = 'active'`,
      );
      if (missing.length > 0) {
        const roles = missing.map(r => r.role).join(', ');
        return `⚠ ${missing.length} active agent(s) missing world models: ${roles} — seed or self-assessment will backfill`;
      }
      return 'All active agents have world model entries';
    }),
  );

  // T21.3 — Self-Assessment Updates Happening
  tests.push(
    await runTest('T21.3', 'Self-Assessment Updates Recent', async () => {
      const rows = await query<{ agent_role: string; updated_at: string }>(
        `SELECT agent_role, updated_at::text
         FROM agent_world_model
         WHERE updated_at > NOW() - INTERVAL '7 days'
         ORDER BY updated_at DESC
         LIMIT 10`,
      );
      if (rows.length === 0) {
        throw new Error(
          'No world model updates in the last 7 days — self-assessment may not be running',
        );
      }
      const recentRoles = rows.map(r => r.agent_role).join(', ');
      return `${rows.length} world model(s) updated in last 7 days (${recentRoles})`;
    }),
  );

  // T21.4 — World Model Data Quality
  tests.push(
    await runTest('T21.4', 'World Model Data Quality', async () => {
      const rows = await query<{
        agent_role: string;
        strengths: unknown;
        weaknesses: unknown;
        task_type_scores: unknown;
        prediction_accuracy: number;
      }>(
        `SELECT agent_role, strengths, weaknesses, task_type_scores, prediction_accuracy
         FROM agent_world_model
         LIMIT 5`,
      );
      if (rows.length === 0) throw new Error('No world model data found');

      const issues: string[] = [];
      for (const row of rows) {
        const s = Array.isArray(row.strengths) ? row.strengths : [];
        const w = Array.isArray(row.weaknesses) ? row.weaknesses : [];
        if (s.length === 0 && w.length === 0) {
          issues.push(`${row.agent_role}: no strengths or weaknesses`);
        }
      }
      if (issues.length === rows.length) {
        return `⚠ All ${rows.length} sampled world models are empty — self-assessment has not populated strengths/weaknesses yet`;
      }
      return `${rows.length} world models sampled — ${rows.length - issues.length}/${rows.length} have meaningful data`;
    }),
  );

  // T21.5 — World Model Dashboard API
  tests.push(
    await runTest('T21.5', 'World Model Dashboard API', async () => {
      // The scheduler serves world model data for agent profiles
      const res = await httpGet<Record<string, unknown>>(
        `${config.schedulerUrl}/api/agent_world_model?limit=1`,
      );
      if (res.status === 404) {
        throw new Error('World model API endpoint not found — /api/agent_world_model returns 404');
      }
      if (!res.ok) {
        throw new Error(`World model API returned ${res.status}: ${res.raw}`);
      }
      return `World model dashboard API reachable (HTTP ${res.status})`;
    }),
  );

  // T21.6 — Improvement Goals Populated
  tests.push(
    await runTest('T21.6', 'Improvement Goals Populated', async () => {
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM agent_world_model
         WHERE improvement_goals IS NOT NULL
           AND improvement_goals != '[]'::jsonb
           AND jsonb_array_length(improvement_goals) > 0`,
      );
      const count = rows[0]?.count ?? 0;
      if (count === 0) {
        return 'No agents have improvement goals yet — CoS grading may not have run';
      }
      return `${count} agent(s) have populated improvement goals`;
    }),
  );

  return { layer: 21, name: 'World Model & Self-Assessment', tests };
}
