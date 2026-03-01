/**
 * Layer 1 – Data Syncs
 * Triggers each third-party sync and verifies recent sync health.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { queryTable } from '../utils/db.js';

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

  // T1.1 — Stripe Sync
  tests.push(
    await runTest('T1.1', 'Stripe Sync', async () => {
      const res = await httpPost<{ success: boolean }>(
        `${config.schedulerUrl}/sync/stripe`,
        {},
      );
      if (!res.ok || !res.data?.success) {
        throw new Error(`Stripe sync failed: status=${res.status}, body=${res.raw}`);
      }
      return 'Stripe sync completed successfully';
    }),
  );

  // T1.2 — Mercury Sync
  tests.push(
    await runTest('T1.2', 'Mercury Sync', async () => {
      const res = await httpPost<{ success: boolean }>(
        `${config.schedulerUrl}/sync/mercury`,
        {},
      );
      if (!res.ok || !res.data?.success) {
        throw new Error(`Mercury sync failed: status=${res.status}, body=${res.raw}`);
      }
      return 'Mercury sync completed successfully';
    }),
  );

  // T1.3 — GCP Billing Sync
  tests.push(
    await runTest('T1.3', 'GCP Billing Sync', async () => {
      const res = await httpPost<{ success: boolean }>(
        `${config.schedulerUrl}/sync/gcp-billing`,
        {},
      );
      if (!res.ok || !res.data?.success) {
        throw new Error(`GCP billing sync failed: status=${res.status}, body=${res.raw}`);
      }
      return 'GCP billing sync completed successfully';
    }),
  );

  // T1.4 — Data Sync Status
  tests.push(
    await runTest('T1.4', 'Data Sync Status', async () => {
      interface SyncRow {
        source: string;
        last_success_at: string | null;
        consecutive_failures: number;
      }
      const rows = await queryTable<SyncRow>('data_sync_status');
      if (rows.length === 0) {
        throw new Error('No rows in data_sync_status');
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const stale = rows.filter(
        (r) => !r.last_success_at || r.last_success_at < oneHourAgo,
      );
      const failing = rows.filter((r) => r.consecutive_failures > 0);

      if (stale.length > 0 || failing.length > 0) {
        const issues: string[] = [];
        if (stale.length) issues.push(`${stale.length} stale sync(s)`);
        if (failing.length) issues.push(`${failing.length} failing sync(s)`);
        throw new Error(issues.join('; '));
      }
      return `All ${rows.length} syncs healthy — recent success, zero failures`;
    }),
  );

  return { layer: 1, name: 'Data Syncs', tests };
}
