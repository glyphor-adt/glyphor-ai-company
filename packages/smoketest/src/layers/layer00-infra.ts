/**
 * Layer 0 – Infrastructure Health
 * Validates that all services, databases, and cloud resources are reachable.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';
import { queryTable } from '../utils/db.js';
import { isGcloudAvailable, gcloudExec } from '../utils/gcloud.js';
import { runTest } from '../utils/test.js';

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

  // T0.2 — Database Connection
  tests.push(
    await runTest('T0.2', 'Database Connection', async () => {
      const rows = await queryTable('company_agents', 'id', undefined, { limit: 1 });
      return `Database reachable — company_agents returned ${rows.length} row(s)`;
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
      const found = topics.some((t) => t.includes('glyphor-agent-tasks'));
      if (!found) {
        throw new Error(
          `glyphor-agent-tasks topic not found. Topics: ${topics.join(', ')}`,
        );
      }
      return `Pub/Sub topic glyphor-agent-tasks present (${topics.length} total topics)`;
    }),
  );
  if (tests[tests.length - 1].message.startsWith('SKIP:')) {
    tests[tests.length - 1].status = 'skipped';
  }

  return { layer: 0, name: 'Infrastructure Health', tests };
}
