/**
 * Layer 8 — Knowledge Graph
 *
 * Validates graph nodes, edges, semantic search embeddings, and GraphRAG indexer.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { getSupabase } from '../utils/supabase.js';

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

  // T8.1 — Graph Has Nodes
  tests.push(
    await runTest('T8.1', 'Graph Has Nodes', async () => {
      const sb = getSupabase(config);
      const { data, error } = await sb
        .from('kg_nodes')
        .select('node_type')
        .eq('status', 'active');
      if (error) throw new Error(`Query failed: ${error.message}`);
      if (!data?.length) throw new Error('No active kg_nodes found');

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
      const sb = getSupabase(config);
      const { data, error } = await sb.from('kg_edges').select('edge_type');
      if (error) throw new Error(`Query failed: ${error.message}`);
      if (!data?.length) throw new Error('No kg_edges found');

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
      const sb = getSupabase(config);
      const { count, error } = await sb
        .from('kg_nodes')
        .select('*', { count: 'exact', head: true })
        .not('embedding', 'is', null);
      if (error) throw new Error(`Query failed: ${error.message}`);
      if (!count) throw new Error('No kg_nodes with embeddings');

      return `${count} nodes have embeddings`;
    }),
  );

  // T8.4 — GraphRAG Indexer
  tests.push(
    await runTest('T8.4', 'GraphRAG Indexer', async () => {
      const resp = await httpPost(`${config.schedulerUrl}/sync/graphrag-index`, {});
      if (!resp.ok) throw new Error(`POST /sync/graphrag-index returned ${resp.status}: ${resp.raw}`);

      const body = resp.data as Record<string, unknown>;
      const msg = body?.message ?? body?.status ?? resp.raw;
      return `GraphRAG index response: ${msg}`;
    }),
  );

  return { layer: 8, name: 'Knowledge Graph', tests };
}
