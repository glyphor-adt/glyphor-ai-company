/**
 * Layer 19 – Worker Service
 *
 * Validates the Cloud Tasks worker: health, run endpoint, and deliver endpoint.
 * The worker is the background task processor for fire-and-forget agent work.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet, httpPost } from '../utils/http.js';
import { runTest } from '../utils/test.js';
import { isGcloudAvailable, gcloudExec } from '../utils/gcloud.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const worker = config.workerUrl;

  // Try to get a GCP identity token for authenticated Cloud Run calls
  let authHeaders: Record<string, string> | undefined;
  if (isGcloudAvailable()) {
    try {
      const token = gcloudExec(`auth print-identity-token --audiences=${worker}`).trim();
      if (token) authHeaders = { Authorization: `Bearer ${token}` };
    } catch { /* will use unauthenticated calls */ }
  }

  // T19.1 — Worker Health
  tests.push(
    await runTest('T19.1', 'Worker Health', async () => {
      const res = await httpGet<Record<string, unknown>>(
        `${worker}/health`,
        30_000,
        authHeaders,
      );
      if (res.ok) {
        const data = res.data as { status?: string; db?: boolean };
        return `Worker healthy — status: ${data.status ?? 'ok'}, db: ${data.db ?? '?'}`;
      }
      // 403 means Cloud Run IAM is blocking unauthenticated — service is reachable
      if (res.status === 403) {
        return 'Worker reachable (HTTP 403 — IAM auth required, expected for unauthenticated calls)';
      }
      throw new Error(`Worker /health returned ${res.status}: ${res.raw}`);
    }),
  );

  // T19.2 — Worker Run Endpoint Exists
  tests.push(
    await runTest('T19.2', 'Worker Run Endpoint', async () => {
      const res = await httpPost<Record<string, unknown>>(
        `${worker}/run`,
        {
          tenantId: 'smoketest',
          agentRole: 'ops',
          taskType: 'health_check',
          modelTier: 'economy',
          metadata: { source: 'smoketest' },
        },
        30_000,
        authHeaders,
      );
      if (res.status === 403) {
        return 'Worker /run reachable (HTTP 403 — IAM auth required, expected)';
      }
      if (res.status === 404) {
        throw new Error('Worker /run endpoint not found (404) — check deployment');
      }
      // 400 = bad request (endpoint exists, validation failed) — acceptable
      if (res.status === 400) {
        return 'Worker /run endpoint exists (HTTP 400 — validation active)';
      }
      if (!res.ok) {
        throw new Error(`Worker /run returned ${res.status}: ${res.raw}`);
      }
      return `Worker /run accepted (HTTP ${res.status})`;
    }),
  );

  // T19.3 — Worker Deliver Endpoint Exists
  tests.push(
    await runTest('T19.3', 'Worker Deliver Endpoint', async () => {
      const res = await httpPost<Record<string, unknown>>(
        `${worker}/deliver`,
        {
          tenantId: 'smoketest',
          agentRole: 'ops',
          channel: 'teams',
          content: 'Smoketest delivery probe',
          platform: 'teams',
        },
        30_000,
        authHeaders,
      );
      if (res.status === 403) {
        return 'Worker /deliver reachable (HTTP 403 — IAM auth required, expected)';
      }
      if (res.status === 404) {
        throw new Error('Worker /deliver endpoint not found (404) — check deployment');
      }
      if (res.status === 400) {
        return 'Worker /deliver endpoint exists (HTTP 400 — validation active)';
      }
      if (!res.ok) {
        throw new Error(`Worker /deliver returned ${res.status}: ${res.raw}`);
      }
      return `Worker /deliver accepted (HTTP ${res.status})`;
    }),
  );

  // T19.4 — Cloud Tasks Queue Has Tasks
  tests.push(
    await runTest('T19.4', 'Cloud Tasks Queue Activity', async () => {
      if (!isGcloudAvailable()) {
        return 'gcloud CLI not available — skipping Cloud Tasks check';
      }
      try {
        const output = gcloudExec(
          'tasks queues describe agent-runs --location=us-central1 --format="value(stats.tasksCount)"',
          config.gcpProject,
        );
        const count = parseInt(output.trim(), 10);
        return `Cloud Tasks agent-runs queue: ${isNaN(count) ? 'active' : `${count} task(s) queued`}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('SERVICE_DISABLED') || msg.includes('not enabled')) {
          return 'Cloud Tasks API not enabled — skipping';
        }
        if (msg.includes('NOT_FOUND')) {
          throw new Error('Cloud Tasks queue "agent-runs" not found — create it in us-central1');
        }
        throw err;
      }
    }),
  );

  return { layer: 19, name: 'Worker Service', tests };
}
