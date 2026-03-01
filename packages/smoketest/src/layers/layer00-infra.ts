/**
 * Layer 0 – Infrastructure Health
 * Validates that all services, databases, and cloud resources are reachable.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';
import { queryTable } from '../utils/supabase.js';
import { isGcloudAvailable, gcloudExec } from '../utils/gcloud.js';

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

  // T0.1 — Cloud Run Services Responding
  tests.push(
    await runTest('T0.1', 'Cloud Run Services Responding', async () => {
      const scheduler = await httpGet<{ status: string }>(
        `${config.schedulerUrl}/health`,
      );
      if (!scheduler.ok || scheduler.data?.status !== 'ok') {
        throw new Error(`Scheduler health: status=${scheduler.status}, body=${scheduler.raw}`);
      }

      const dashboard = await httpGet(`${config.dashboardUrl}/`);
      if (!dashboard.ok) {
        throw new Error(`Dashboard returned status ${dashboard.status}`);
      }

      const voice = await httpGet<{ status: string }>(
        `${config.voiceGatewayUrl}/health`,
      );
      if (!voice.ok) {
        throw new Error(`Voice gateway returned status ${voice.status}`);
      }

      return 'All three Cloud Run services responding';
    }),
  );

  // T0.2 — Supabase Connection
  tests.push(
    await runTest('T0.2', 'Supabase Connection', async () => {
      const rows = await queryTable(config, 'company_agents', 'id', undefined, { limit: 1 });
      return `Supabase reachable — company_agents returned ${rows.length} row(s)`;
    }),
  );

  // T0.3 — Redis Connected
  tests.push(
    await runTest('T0.3', 'Redis Connected', async () => {
      const res = await httpGet<{ status: string; redis?: string }>(
        `${config.schedulerUrl}/health`,
      );
      if (!res.ok) {
        throw new Error(`Scheduler health returned status ${res.status}`);
      }
      const body = res.data as Record<string, unknown>;
      const redisStatus = body?.redis ?? body?.redisStatus ?? body?.cache;
      if (!redisStatus) {
        throw new Error(`No redis status found in health response: ${res.raw}`);
      }
      return `Redis status: ${redisStatus}`;
    }),
  );

  // T0.4 — GCP Secret Manager
  tests.push(
    await runTest('T0.4', 'GCP Secret Manager', async () => {
      if (!isGcloudAvailable()) {
        return 'SKIP: gcloud CLI not available';
      }
      const output = gcloudExec(
        'secrets list --format="value(name)"',
        config.gcpProject,
      );
      const lines = output.trim().split('\n').filter(Boolean);
      return `${lines.length} secret(s) found in Secret Manager`;
    }),
  );
  // Mark T0.4 as skipped if gcloud unavailable
  if (tests[tests.length - 1].message.startsWith('SKIP:')) {
    tests[tests.length - 1].status = 'skipped';
  }

  // T0.5 — Pub/Sub Topic
  tests.push(
    await runTest('T0.5', 'Pub/Sub Topic exists', async () => {
      if (!isGcloudAvailable()) {
        return 'SKIP: gcloud CLI not available';
      }
      const output = gcloudExec(
        'pubsub topics list --format="value(name)"',
        config.gcpProject,
      );
      const topics = output.trim().split('\n').filter(Boolean);
      const found = topics.some((t) => t.includes('glyphor-agent-events'));
      if (!found) {
        throw new Error(
          `glyphor-agent-events topic not found. Topics: ${topics.join(', ')}`,
        );
      }
      return `Pub/Sub topic glyphor-agent-events present (${topics.length} total topics)`;
    }),
  );
  if (tests[tests.length - 1].message.startsWith('SKIP:')) {
    tests[tests.length - 1].status = 'skipped';
  }

  // T0.6 — Agent Runs Query Schema
  tests.push(
    await runTest('T0.6', 'Agent Runs Query Schema', async () => {
      const { getSupabase } = await import('../utils/supabase.js');
      const sb = getSupabase(config);
      
      // Validate query_ai_usage schema compatibility:
      // Test that we can query agent_runs with join to company_agents
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await sb
        .from('agent_runs')
        .select('agent_id, input_tokens, output_tokens, cost, created_at, status, company_agents!inner(role, model)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        throw new Error(`Query failed: ${error.message}`);
      }

      // Validate structure of returned data
      if (data && data.length > 0) {
        const sample = data[0] as any;
        if (!('agent_id' in sample)) throw new Error('Missing agent_id column');
        if (!('input_tokens' in sample)) throw new Error('Missing input_tokens column');
        if (!('output_tokens' in sample)) throw new Error('Missing output_tokens column');
        if (!('cost' in sample)) throw new Error('Missing cost column');
        if (!('company_agents' in sample)) throw new Error('Missing company_agents join');
        if (sample.company_agents && !('model' in sample.company_agents)) {
          throw new Error('Missing model in company_agents join');
        }
      }

      return `agent_runs schema validated — ${data?.length ?? 0} recent run(s) found`;
    }),
  );

  return { layer: 0, name: 'Infrastructure Health', tests };
}
