/**
 * Layer 20 – GraphRAG Indexer
 *
 * Validates the Python GraphRAG indexer service: health, index trigger,
 * tune trigger, and verifies graph data freshness via the database.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpGet, httpPost } from '../utils/http.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';
import { isGcloudAvailable, gcloudExec } from '../utils/gcloud.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const graphrag = config.graphragUrl;

  // Try to get a GCP identity token for authenticated Cloud Run calls
  let authHeaders: Record<string, string> | undefined;
  if (isGcloudAvailable()) {
    try {
      const token = gcloudExec(`auth print-identity-token --audiences=${graphrag}`).trim();
      if (token) authHeaders = { Authorization: `Bearer ${token}` };
    } catch { /* will use unauthenticated calls */ }
  }

  // T20.1 — GraphRAG Service Health
  tests.push(
    await runTest('T20.1', 'GraphRAG Service Health', async () => {
      const res = await httpGet<Record<string, unknown>>(
        `${graphrag}/health`,
        30_000,
        authHeaders,
      );
      if (res.ok) {
        const data = res.data as { status?: string; service?: string };
        return `GraphRAG indexer healthy — status: ${data.status ?? 'ok'}, service: ${data.service ?? 'graphrag-indexer'}`;
      }
      if (res.status === 403) {
        return 'GraphRAG indexer reachable (HTTP 403 — IAM auth required, expected)';
      }
      throw new Error(`GraphRAG /health returned ${res.status}: ${res.raw}`);
    }),
  );

  // T20.2 — Index Trigger Endpoint
  tests.push(
    await runTest('T20.2', 'Index Trigger Endpoint', async () => {
      // POST /index with source=docs triggers a background indexing run
      // We only verify the endpoint accepts the request (HTTP 202), not completion
      const res = await httpPost<Record<string, unknown>>(
        `${graphrag}/index`,
        { source: 'docs' },
        30_000,
        authHeaders,
      );
      if (res.status === 403) {
        return 'GraphRAG /index reachable (HTTP 403 — IAM auth required, expected)';
      }
      if (res.status === 404) {
        throw new Error('GraphRAG /index endpoint not found (404) — check deployment');
      }
      if (res.status === 202 || res.ok) {
        return `GraphRAG /index accepted (HTTP ${res.status}) — indexing started in background`;
      }
      if (res.status === 409 || res.status === 429) {
        return `GraphRAG /index busy (HTTP ${res.status}) — indexing already in progress`;
      }
      throw new Error(`GraphRAG /index returned unexpected ${res.status}: ${res.raw}`);
    }),
  );

  // T20.3 — Tune Endpoint
  tests.push(
    await runTest('T20.3', 'Tune Endpoint', async () => {
      const res = await httpPost<Record<string, unknown>>(
        `${graphrag}/tune`,
        { source: 'docs', limit: 5 },
        30_000,
        authHeaders,
      );
      if (res.status === 403) {
        return 'GraphRAG /tune reachable (HTTP 403 — IAM auth required, expected)';
      }
      if (res.status === 404) {
        throw new Error('GraphRAG /tune endpoint not found (404) — check deployment');
      }
      if (res.status === 202 || res.ok) {
        return `GraphRAG /tune accepted (HTTP ${res.status}) — tuning started in background`;
      }
      if (res.status === 409 || res.status === 429) {
        return `GraphRAG /tune busy (HTTP ${res.status}) — tuning already in progress`;
      }
      throw new Error(`GraphRAG /tune returned unexpected ${res.status}: ${res.raw}`);
    }),
  );

  // T20.4 — Graph Data Freshness
  tests.push(
    await runTest('T20.4', 'Graph Data Freshness', async () => {
      const rows = await query<{
        status: string;
        last_success_at: string | null;
        consecutive_failures: number;
      }>(
        `SELECT status, last_success_at, consecutive_failures
         FROM data_sync_status WHERE id = 'graphrag-index'`,
      );
      if (!rows.length) {
        throw new Error('No data_sync_status row for graphrag-index — indexer has never run');
      }
      const row = rows[0];
      if (row.consecutive_failures > 3) {
        throw new Error(
          `GraphRAG indexer has ${row.consecutive_failures} consecutive failures — investigate logs`,
        );
      }
      if (!row.last_success_at) {
        throw new Error('GraphRAG indexer has never completed successfully');
      }
      const lastRun = new Date(row.last_success_at);
      const hoursSince = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 48) {
        throw new Error(
          `GraphRAG last success was ${hoursSince.toFixed(1)}h ago — should run at least daily`,
        );
      }
      return `GraphRAG indexer status: ${row.status}, last success: ${row.last_success_at} (${hoursSince.toFixed(1)}h ago)`;
    }),
  );

  // T20.5 — Embedding Coverage
  tests.push(
    await runTest('T20.5', 'Embedding Coverage', async () => {
      const result = await query<{ total: number; with_embedding: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding
         FROM kg_nodes
         WHERE status = 'active'`,
      );
      const { total, with_embedding } = result[0] ?? { total: 0, with_embedding: 0 };
      if (total === 0) {
        throw new Error('No active kg_nodes — knowledge graph is empty');
      }
      const pct = ((with_embedding / total) * 100).toFixed(1);
      if (with_embedding < total * 0.5) {
        throw new Error(
          `Only ${pct}% of nodes have embeddings (${with_embedding}/${total}) — should be >50%`,
        );
      }
      return `${with_embedding}/${total} active nodes have embeddings (${pct}%)`;
    }),
  );

  return { layer: 20, name: 'GraphRAG Indexer', tests };
}
