/**
 * Layer 8 — Knowledge Graph
 *
 * Validates graph nodes, edges, semantic search embeddings, and GraphRAG indexer.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
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
      const resp = await httpPost(`${config.schedulerUrl}/sync/graphrag-index`, {});
      if (!resp.ok) {
        throw new Error(`POST /sync/graphrag-index returned ${resp.status}: ${resp.raw}`);
      }

      const body = resp.data as Record<string, unknown>;
      const msg = body?.message ?? body?.status ?? resp.raw;
      return `GraphRAG index response: ${msg}`;
    }),
  );

  return { layer: 8, name: 'Knowledge Graph', tests };
}
