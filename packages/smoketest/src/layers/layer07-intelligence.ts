/**
 * Layer 7 — Intelligence Enhancements
 *
 * Validates constitutional governance, decision chains, formal verification,
 * causal knowledge graph, episodic replay, drift detection, and verifier agents.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { queryTable, getSupabase } from '../utils/supabase.js';

async function runTest(
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { id, name, status: 'pass', message, durationMs: Date.now() - start };
  } catch (err) {
    return { id, name, status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T7.1 — Constitutional Governance
  tests.push(
    await runTest('T7.1', 'Constitutional Governance', async () => {
      const constitutions = await queryTable(config, 'agent_constitutions', '*', { active: true });
      if (!constitutions.length) throw new Error('No active agent constitutions found');

      const evals = await queryTable<{ compliance_score: number }>(
        config,
        'constitutional_evaluations',
        '*',
        undefined,
        { order: 'created_at', desc: true, limit: 10 },
      );
      if (!evals.length) throw new Error('No constitutional evaluations found');

      const passing = evals.filter(e => e.compliance_score > 0.5);
      if (!passing.length) throw new Error('No evaluations with compliance_score > 0.5');

      return `${constitutions.length} active constitutions, ${passing.length}/${evals.length} evaluations with score > 0.5`;
    }),
  );

  // T7.2 — Decision Chains
  tests.push(
    await runTest('T7.2', 'Decision Chains', async () => {
      const chains = await queryTable(
        config,
        'decision_chains',
        '*',
        undefined,
        { order: 'created_at', desc: true, limit: 10 },
      );
      if (!chains.length) throw new Error('No decision chains found');
      return `${chains.length} recent decision chains`;
    }),
  );

  // T7.3 — Formal Verification
  tests.push(
    await runTest('T7.3', 'Formal Verification', async () => {
      const sb = getSupabase(config);
      const { data, error } = await sb
        .from('platform_audit_log')
        .select('*')
        .or('action.ilike.%verif%,response_summary.ilike.%verif%')
        .limit(10);
      if (error) throw new Error(`Query failed: ${error.message}`);
      if (!data?.length) throw new Error('No verification entries in audit log');
      return `${data.length} verification-related audit entries`;
    }),
  );

  // T7.4 — Causal Knowledge Graph
  tests.push(
    await runTest('T7.4', 'Causal Knowledge Graph', async () => {
      const sb = getSupabase(config);
      const { data, error } = await sb
        .from('kg_edges')
        .select('*')
        .not('causal_confidence', 'is', null)
        .limit(10);
      if (error) throw new Error(`Query failed: ${error.message}`);
      if (!data?.length) throw new Error('No kg_edges with causal_confidence');
      return `${data.length} causal edges found`;
    }),
  );

  // T7.5 — Episodic Replay
  tests.push(
    await runTest('T7.5', 'Episodic Replay', async () => {
      const episodes = await queryTable(
        config,
        'shared_episodes',
        '*',
        undefined,
        { order: 'created_at', desc: true, limit: 10 },
      );
      if (!episodes.length) throw new Error('No shared episodes found');

      const sb = getSupabase(config);
      const { count, error } = await sb
        .from('shared_episodes')
        .select('*', { count: 'exact', head: true })
        .gt('significance_score', 0.7);
      if (error) throw new Error(`Count query failed: ${error.message}`);

      return `${episodes.length} recent episodes, ${count ?? 0} with significance > 0.7`;
    }),
  );

  // T7.6 — Drift Detection
  tests.push(
    await runTest('T7.6', 'Drift Detection', async () => {
      const alerts = await queryTable<{ severity?: string; acknowledged?: boolean }>(
        config,
        'drift_alerts',
        '*',
        undefined,
        { order: 'detected_at', desc: true, limit: 20 },
      );
      if (!alerts.length) throw new Error('No drift alerts found');

      const criticalUnacked = alerts.filter(
        a => a.severity === 'critical' && !a.acknowledged,
      );
      if (criticalUnacked.length) {
        throw new Error(`${criticalUnacked.length} critical unacknowledged drift alert(s)`);
      }

      return `${alerts.length} drift alerts, no critical unacknowledged`;
    }),
  );

  // T7.7 — Verifier Agents
  tests.push(
    await runTest('T7.7', 'Verifier Agents', async () => {
      const resp = await httpPost(
        `${config.schedulerUrl}/run`,
        {
          agentRole: 'cfo',
          task: 'on_demand',
          message:
            'Run a financial health assessment and verify the results with cross-model verification.',
        },
        90_000,
      );
      if (!resp.ok) throw new Error(`POST /run returned ${resp.status}: ${resp.raw}`);
      return `Verifier agent responded (status ${resp.status})`;
    }),
  );

  return { layer: 7, name: 'Intelligence Enhancements', tests };
}
