/**
 * Layer 0 – Infrastructure Health
 * Validates that all services, databases, and cloud resources are reachable.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet } from '../utils/http.js';
import { queryTable, query } from '../utils/db.js';
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
        throw new Error('gcloud CLI not available — install Google Cloud SDK');
      }
      const output = gcloudExec(
        'secrets list --format="value(name)"',
        config.gcpProject,
      );
      const lines = output.trim().split('\n').filter(Boolean);
      return `${lines.length} secret(s) found in Secret Manager`;
    }),
  );

  // T0.5 — Pub/Sub Topic
  tests.push(
    await runTest('T0.5', 'Pub/Sub Topic exists', async () => {
      if (!isGcloudAvailable()) {
        throw new Error('gcloud CLI not available — install Google Cloud SDK');
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

  // T0.6 — Worker Service Health
  tests.push(
    await runTest('T0.6', 'Worker Service Responding', async () => {
      const workerUrl = process.env.WORKER_URL;
      if (!workerUrl) {
        throw new Error('WORKER_URL not set — add to .env');
      }
      const res = await httpGet<{ status: string }>(workerUrl.replace(/\/$/, '') + '/health');
      if (!res.ok) {
        throw new Error(`Worker /health returned status ${res.status}`);
      }
      return `Worker service healthy (HTTP ${res.status})`;
    }),
  );

  // T0.7 — Cloud Tasks Queues
  tests.push(
    await runTest('T0.7', 'Cloud Tasks Queues', async () => {
      if (!isGcloudAvailable()) {
        throw new Error('gcloud CLI not available — install Google Cloud SDK');
      }
      const output = gcloudExec(
        'tasks queues list --location=us-central1 --format="value(name)"',
        config.gcpProject,
      );
      const queues = output.trim().split('\n').filter(Boolean);
      const expected = ['agent-runs', 'delivery'];
      const found = expected.filter(q => queues.some(line => line.includes(q)));
      if (found.length < 2) {
        throw new Error(
          `Missing Cloud Tasks queues. Expected: ${expected.join(', ')}. Found: ${queues.join(', ')}`,
        );
      }
      return `${queues.length} Cloud Tasks queue(s) present (${found.join(', ')})`;
    }),
  );

  // T0.8 — Cloud Storage Bucket
  tests.push(
    await runTest('T0.8', 'Cloud Storage Bucket', async () => {
      if (!isGcloudAvailable()) {
        throw new Error('gcloud CLI not available — install Google Cloud SDK');
      }
      const output = gcloudExec(
        'storage buckets list --format="value(name)"',
        config.gcpProject,
      );
      const buckets = output.trim().split('\n').filter(Boolean);
      const found = buckets.some(b => b.includes('glyphor'));
      if (!found) {
        throw new Error(`No glyphor bucket found. Buckets: ${buckets.join(', ')}`);
      }
      return `${buckets.length} bucket(s) found (glyphor bucket present)`;
    }),
  );

  // T0.9 — Multi-Tenancy Tables
  tests.push(
    await runTest('T0.9', 'Multi-Tenancy Tables', async () => {
      const tenants = await queryTable('tenants', 'id,slug', undefined, { limit: 5 });
      if (tenants.length === 0) {
        throw new Error('No rows in tenants table — multi-tenancy migration not applied');
      }
      const cols = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public'`,
      );
      const colCount = cols[0]?.count ?? 0;
      if (colCount < 10) {
        throw new Error(`Only ${colCount} tables have tenant_id column — expected 14+`);
      }
      return `${tenants.length} tenant(s), ${colCount} tables with tenant_id`;
    }),
  );

  return { layer: 0, name: 'Infrastructure Health', tests };
}
