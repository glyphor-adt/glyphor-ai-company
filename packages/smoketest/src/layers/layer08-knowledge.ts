/**
 * Layer 8 — Knowledge Graph
 *
 * Validates graph nodes, edges, semantic search embeddings, and GraphRAG indexer.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T8.1 — Graph Has Nodes
  tests.push(
    await runTest('T8.1', 'Graph Has Nodes', async () => {
      const data = await query<{ node_type: string }>(
        `SELECT node_type FROM kg_nodes WHERE status = 'active'`,
      );
      if (!data.length) throw new Error('No active kg_nodes found');

      const types = new Set(data.map(r => r.node_type));
      const expected = ['entity', 'fact', 'observation', 'pattern'];
      const found = expected.filter(t => types.has(t));
      if (found.length < 2) {
        throw new Error(
          `Only ${found.length} expected node types found (${found.join(', ')}); need at least 2`,
        );
      }

      return `${data.length} active nodes across ${types.size} types (matched: ${found.join(', ')})`;
    }),
  );

  // T8.2 — Graph Has Edges
  tests.push(
    await runTest('T8.2', 'Graph Has Edges', async () => {
      const data = await query<{ edge_type: string }>(
        `SELECT edge_type FROM kg_edges`,
      );
      if (!data.length) throw new Error('No kg_edges found');

      const types = new Set(data.map(r => r.edge_type));
      if (types.size < 2) {
        throw new Error(`Only ${types.size} edge type(s) found; need at least 2`);
      }

      return `${data.length} edges across ${types.size} types`;
    }),
  );

  // T8.3 — Semantic Search
  tests.push(
    await runTest('T8.3', 'Semantic Search', async () => {
      const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM kg_nodes WHERE embedding IS NOT NULL`,
      );
      const count = result[0]?.count ?? 0;
      if (!count) throw new Error('No kg_nodes with embeddings');

      return `${count} nodes have embeddings`;
    }),
  );

  // T8.4 — GraphRAG Indexer
  tests.push(
    await runTest('T8.4', 'GraphRAG Indexer', async () => {
      const rows = await query<{ status: string; last_success_at: string | null; last_failure_at: string | null; consecutive_failures: number }>(
        `SELECT status, last_success_at, last_failure_at, consecutive_failures FROM data_sync_status WHERE id = 'graphrag-index'`,
      );
      if (!rows.length) throw new Error('No data_sync_status row for graphrag-index — indexer has never run');

      const row = rows[0];
      if (row.status === 'failing') {
        throw new Error(`GraphRAG indexer status is "failing" (${row.consecutive_failures} consecutive failures)`);
      }

      const lastRun = row.last_success_at ?? row.last_failure_at ?? 'never';
      return `GraphRAG indexer status: ${row.status}, last run: ${lastRun}`;
    }),
  );

  return { layer: 8, name: 'Knowledge Graph', tests };
}
