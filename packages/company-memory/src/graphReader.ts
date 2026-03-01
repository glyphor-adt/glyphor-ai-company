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
    _agentId: string,
    options: {
      limit?: number;
      expandHops?: number;
      nodeTypes?: string[];
      department?: string;
    } = {},
  ): Promise<GraphContext> {
    const { limit = 10, expandHops = 1 } = options;

    const queryEmb = await this.embedding.embed(query);

    const results = await systemQuery<GraphContextNode>(
      'SELECT * FROM kg_semantic_search_with_context($1, $2, $3, $4)',
      [JSON.stringify(queryEmb), 0.65, Math.ceil(limit / 2), expandHops],
    );

    if (!results.length) return { nodes: [], narrative: '' };

    return this.formatGraphContext(results, limit);
  }

  /**
   * Causal chain: "why did X happen?"
   * Walks backward through caused/contributed_to edges.
   */
  async traceCauses(nodeTitle: string): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle);
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
  async traceImpact(nodeTitle: string): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle);
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
  async findNodeByTitle(title: string): Promise<{ id: string; title: string } | null> {
    const rows = await systemQuery<{ id: string; title: string }>(
      'SELECT id, title FROM kg_nodes WHERE title ILIKE $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [`%${title}%`, 'active'],
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
   * Multi-hop causal traversal: find all causal edges (CAUSAL_INFLUENCES)
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
        `SELECT source_id, target_id, causal_confidence, causal_mechanism, edge_type FROM kg_edges WHERE ${col} = $1 AND edge_type = $2 AND causal_confidence > $3`,
        [nodeId, 'CAUSAL_INFLUENCES', 0],
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
