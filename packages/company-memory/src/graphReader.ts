/**
 * Knowledge Graph Reader — Read context from graph (semantic + traversal).
 *
 * Primary read interface for agents. Supports:
 * - Semantic search with N-hop graph expansion
 * - Causal chain tracing (backward / forward)
 * - Neighborhood expansion
 * - Tiered context loading (light / standard / full)
 */

import { systemQuery } from '@glyphor/shared/db';
import type { EmbeddingClient } from './embeddingClient.js';

// ─── Types ────────────────────────────────────────────────────────

export interface GraphContextNode {
  node_id: string;
  node_type: string;
  title: string;
  content: string;
  category: string;
  similarity: number;
  is_direct_match: boolean;
  connected_via: string | null;
  connected_from: string | null;
}

export interface GraphContext {
  nodes: GraphContextNode[];
  narrative: string;
}

export interface CausalChainNode {
  node_id: string;
  node_type: string;
  title: string;
  content: string;
  depth: number;
  edge_type: string | null;
  edge_strength: number | null;
  path: string[];
}

// ─── Icons ────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, string> = {
  event: '[event]',
  fact: '[fact]',
  observation: '[obs]',
  pattern: '[pattern]',
  decision: '[decision]',
  metric: '[metric]',
  entity: '[entity]',
  goal: '[goal]',
  risk: '[risk]',
  action: '[action]',
  hypothesis: '[hypothesis]',
};

// ─── Reader ───────────────────────────────────────────────────────

export class KnowledgeGraphReader {
  constructor(
    private embedding: EmbeddingClient,
  ) {}

  /**
   * Primary read method: semantic search + graph expansion.
   * Used during context loading for agent runs.
   */
  async getRelevantContext(
    query: string,
    agentId: string,
    options: {
      limit?: number;
      expandHops?: number;
      nodeTypes?: string[];
      department?: string;
    } = {},
  ): Promise<GraphContext> {
    const { limit = 10, expandHops = 1 } = options;

    const queryEmb = await this.embedding.embed(query);
    const queryVector = `[${queryEmb.join(',')}]`;

    const results = await systemQuery<GraphContextNode>(
      `WITH allowed_scope AS (
         SELECT
           CASE
             WHEN $5 = 'system' THEN ARRAY['*']::text[]
             ELSE COALESCE(
               (SELECT knowledge_access_scope FROM company_agents WHERE role = $5 LIMIT 1),
               ARRAY['general']::text[]
             )
           END AS scopes
       ),
       direct_matches AS (
         SELECT
           n.id AS node_id,
           n.node_type,
           n.title,
           n.content,
           COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') AS category,
           (1 - (n.embedding <=> $1::vector))::DECIMAL AS similarity
         FROM kg_nodes n
         CROSS JOIN allowed_scope s
         WHERE n.status = 'active'
           AND n.embedding IS NOT NULL
           AND 1 - (n.embedding <=> $1::vector) > $2
           AND (
             $5 = 'system'
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = ANY(s.scopes)
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = 'general'
           )
         ORDER BY n.embedding <=> $1::vector
         LIMIT $3
       ),
       expanded AS (
         SELECT DISTINCT ON (n.id)
           n.id AS node_id,
           n.node_type,
           n.title,
           n.content,
           COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') AS category,
           (dm.similarity * e.strength)::DECIMAL AS similarity,
           FALSE AS is_direct_match,
           e.edge_type AS connected_via,
           dm.title AS connected_from
         FROM direct_matches dm
         JOIN kg_edges e ON (e.source_id = dm.node_id OR e.target_id = dm.node_id) AND e.valid_until IS NULL
         JOIN kg_nodes n ON n.id = CASE
           WHEN e.source_id = dm.node_id THEN e.target_id
           ELSE e.source_id
         END
         CROSS JOIN allowed_scope s
         WHERE n.status = 'active'
           AND n.id NOT IN (SELECT node_id FROM direct_matches)
           AND $4 >= 1
           AND (
             $5 = 'system'
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = ANY(s.scopes)
             OR COALESCE(NULLIF(n.metadata->>'category', ''), NULLIF(n.department, ''), 'general') = 'general'
           )
         ORDER BY n.id, (dm.similarity * e.strength)::DECIMAL DESC
       )
       SELECT node_id, node_type, title, content, category, similarity, TRUE AS is_direct_match, NULL::TEXT AS connected_via, NULL::TEXT AS connected_from
       FROM direct_matches
       UNION ALL
       SELECT node_id, node_type, title, content, category, similarity, is_direct_match, connected_via, connected_from
       FROM expanded
       ORDER BY similarity DESC`,
      [queryVector, 0.65, Math.ceil(limit / 2), expandHops, agentId],
    );

    if (!results.length) return { nodes: [], narrative: '' };

    return this.formatGraphContext(results, limit);
  }

  /**
   * Causal chain: "why did X happen?"
   * Walks backward through caused/contributed_to edges.
   */
  async traceCauses(nodeTitle: string, agentId = 'system'): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle, agentId);
    if (!node) return 'No matching event found in the knowledge graph.';

    const chain = await systemQuery<CausalChainNode>(
      'SELECT * FROM kg_trace_causes($1, $2)',
      [node.id, 5],
    );

    if (!chain.length) return `No known causes for "${nodeTitle}".`;

    return this.formatCausalChain(nodeTitle, chain);
  }

  /**
   * Impact analysis: "what happened because of X?"
   * Walks forward through caused/resulted_in/affects edges.
   */
  async traceImpact(nodeTitle: string, agentId = 'system'): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle, agentId);
    if (!node) return 'No matching event found in the knowledge graph.';

    const chain = await systemQuery<CausalChainNode>(
      'SELECT * FROM kg_trace_impact($1, $2)',
      [node.id, 5],
    );

    if (!chain.length) return `No known impact from "${nodeTitle}".`;

    return this.formatImpactChain(nodeTitle, chain);
  }

  /**
   * Search for a single node by title (fuzzy match).
   */
  async findNodeByTitle(title: string, agentId = 'system'): Promise<{ id: string; title: string } | null> {
    const rows = await systemQuery<{ id: string; title: string }>(
      `WITH allowed_scope AS (
         SELECT
           CASE
             WHEN $2 = 'system' THEN ARRAY['*']::text[]
             ELSE COALESCE(
               (SELECT knowledge_access_scope FROM company_agents WHERE role = $2 LIMIT 1),
               ARRAY['general']::text[]
             )
           END AS scopes
       )
       SELECT id, title
       FROM kg_nodes
       CROSS JOIN allowed_scope s
       WHERE title ILIKE $1
         AND status = 'active'
         AND (
           $2 = 'system'
           OR COALESCE(NULLIF(metadata->>'category', ''), NULLIF(department, ''), 'general') = ANY(s.scopes)
           OR COALESCE(NULLIF(metadata->>'category', ''), NULLIF(department, ''), 'general') = 'general'
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [`%${title}%`, agentId],
    );
    return rows[0] ?? null;
  }

  // ─── Formatting ─────────────────────────────────────────────────

  private formatGraphContext(results: GraphContextNode[], limit: number): GraphContext {
    const nodes = results.slice(0, limit);

    const directMatches = nodes.filter((n) => n.is_direct_match);
    const expanded = nodes.filter((n) => !n.is_direct_match);

    const parts: string[] = [];

    if (directMatches.length) {
      parts.push('## Relevant Knowledge');
      for (const node of directMatches) {
        const icon = NODE_ICONS[node.node_type] ?? '•';
        parts.push(`${icon} **${node.title}**: ${node.content}`);
      }
    }

    if (expanded.length) {
      parts.push('');
      parts.push('## Connected Context');
      for (const node of expanded) {
        parts.push(
          `  ↳ ${node.title} (${node.connected_via} → ${node.connected_from})`,
        );
      }
    }

    return { nodes, narrative: parts.join('\n') };
  }

  private formatCausalChain(startTitle: string, chain: CausalChainNode[]): string {
    const parts: string[] = [`## Causal Chain for "${startTitle}"`];
    const byDepth = new Map<number, CausalChainNode[]>();

    for (const node of chain) {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
      byDepth.get(node.depth)!.push(node);
    }

    for (const [depth, nodes] of byDepth) {
      const indent = '  '.repeat(depth);
      for (const node of nodes) {
        const pct = node.edge_strength != null ? Math.round(node.edge_strength * 100) : '?';
        parts.push(`${indent}← ${node.edge_type} (${pct}%): ${node.title}`);
        parts.push(`${indent}  ${node.content}`);
      }
    }

    return parts.join('\n');
  }

  private formatImpactChain(startTitle: string, chain: CausalChainNode[]): string {
    const parts: string[] = [`## Impact Chain from "${startTitle}"`];

    for (const node of chain) {
      const indent = '  '.repeat(node.depth);
      const pct = node.edge_strength != null ? Math.round(node.edge_strength * 100) : '?';
      parts.push(`${indent}→ ${node.edge_type} (${pct}%): ${node.title}`);
    }

    return parts.join('\n');
  }

  // ─── Causal Impact Analysis (Enhancement 5) ──────────────────

  /**
  * Multi-hop causal traversal: find all edges with causal confidence metadata
   * reachable from a node, both upstream (causes) and downstream (effects).
   * Returns a structured report with confidence scores.
   */
  async traceCausalImpact(nodeTitle: string, maxDepth = 3): Promise<{
    causes: Array<{ title: string; confidence: number; mechanism: string | null; depth: number }>;
    effects: Array<{ title: string; confidence: number; mechanism: string | null; depth: number }>;
    narrative: string;
  }> {
    const node = await this.findNodeByTitle(nodeTitle);
    if (!node) {
      return { causes: [], effects: [], narrative: `No matching node for "${nodeTitle}".` };
    }

    // Trace upstream (causes → this node)
    const causes = await this.traceCausalDirection(node.id, 'upstream', maxDepth);

    // Trace downstream (this node → effects)
    const effects = await this.traceCausalDirection(node.id, 'downstream', maxDepth);

    // Build narrative
    const parts: string[] = [`## Causal Impact Analysis: "${nodeTitle}"`];

    if (causes.length > 0) {
      parts.push('\n### Root Causes');
      for (const c of causes) {
        const mech = c.mechanism ? ` via ${c.mechanism}` : '';
        parts.push(`${'  '.repeat(c.depth)}← (${Math.round(c.confidence * 100)}%${mech}) ${c.title}`);
      }
    }

    if (effects.length > 0) {
      parts.push('\n### Downstream Effects');
      for (const e of effects) {
        const mech = e.mechanism ? ` via ${e.mechanism}` : '';
        parts.push(`${'  '.repeat(e.depth)}→ (${Math.round(e.confidence * 100)}%${mech}) ${e.title}`);
      }
    }

    if (causes.length === 0 && effects.length === 0) {
      parts.push('\nNo causal relationships found.');
    }

    return { causes, effects, narrative: parts.join('\n') };
  }

  private async traceCausalDirection(
    startId: string,
    direction: 'upstream' | 'downstream',
    maxDepth: number,
  ): Promise<Array<{ title: string; confidence: number; mechanism: string | null; depth: number }>> {
    const results: Array<{ title: string; confidence: number; mechanism: string | null; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= maxDepth || visited.has(nodeId)) continue;
      visited.add(nodeId);

      const col = direction === 'upstream' ? 'target_id' : 'source_id';
      const edges = await systemQuery<{
        source_id: string; target_id: string;
        causal_confidence: number; causal_mechanism: string | null; edge_type: string;
      }>(
        `SELECT source_id, target_id, causal_confidence, causal_mechanism, edge_type
         FROM kg_edges
         WHERE ${col} = $1 AND causal_confidence > $2 AND valid_until IS NULL`,
        [nodeId, 0],
      );

      for (const edge of edges) {
        const nextId = direction === 'upstream' ? edge.source_id : edge.target_id;
        if (visited.has(nextId)) continue;

        const [nodeData] = await systemQuery<{ title: string }>(
          'SELECT title FROM kg_nodes WHERE id = $1',
          [nextId],
        );

        if (nodeData) {
          results.push({
            title: nodeData.title,
            confidence: edge.causal_confidence ?? 0.5,
            mechanism: edge.causal_mechanism ?? null,
            depth: depth + 1,
          });
        }

        queue.push({ nodeId: nextId, depth: depth + 1 });
      }
    }

    return results;
  }
}
