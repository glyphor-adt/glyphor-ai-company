/**
 * Knowledge Graph Reader — Read context from graph (semantic + traversal).
 *
 * Primary read interface for agents. Supports:
 * - Semantic search with N-hop graph expansion
 * - Causal chain tracing (backward / forward)
 * - Neighborhood expansion
 * - Tiered context loading (light / standard / full)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
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
  event: '⚡',
  fact: '📌',
  observation: '👁',
  pattern: '🔄',
  decision: '⚖️',
  metric: '📊',
  entity: '🏢',
  goal: '🎯',
  risk: '⚠️',
  action: '🔧',
  hypothesis: '🔬',
};

// ─── Reader ───────────────────────────────────────────────────────

export class KnowledgeGraphReader {
  constructor(
    private supabase: SupabaseClient,
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

    const { data: results } = await this.supabase.rpc(
      'kg_semantic_search_with_context',
      {
        query_embedding: JSON.stringify(queryEmb),
        match_threshold: 0.65,
        match_count: Math.ceil(limit / 2),
        expand_hops: expandHops,
      },
    );

    if (!results?.length) return { nodes: [], narrative: '' };

    return this.formatGraphContext(results, limit);
  }

  /**
   * Causal chain: "why did X happen?"
   * Walks backward through caused/contributed_to edges.
   */
  async traceCauses(nodeTitle: string): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle);
    if (!node) return 'No matching event found in the knowledge graph.';

    const { data: chain } = await this.supabase.rpc('kg_trace_causes', {
      start_node_id: node.id,
      max_depth: 5,
    });

    if (!chain?.length) return `No known causes for "${nodeTitle}".`;

    return this.formatCausalChain(nodeTitle, chain);
  }

  /**
   * Impact analysis: "what happened because of X?"
   * Walks forward through caused/resulted_in/affects edges.
   */
  async traceImpact(nodeTitle: string): Promise<string> {
    const node = await this.findNodeByTitle(nodeTitle);
    if (!node) return 'No matching event found in the knowledge graph.';

    const { data: chain } = await this.supabase.rpc('kg_trace_impact', {
      start_node_id: node.id,
      max_depth: 5,
    });

    if (!chain?.length) return `No known impact from "${nodeTitle}".`;

    return this.formatImpactChain(nodeTitle, chain);
  }

  /**
   * Search for a single node by title (fuzzy match).
   */
  async findNodeByTitle(title: string): Promise<{ id: string; title: string } | null> {
    const { data } = await this.supabase
      .from('kg_nodes')
      .select('id, title')
      .ilike('title', `%${title}%`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data ?? null;
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
}
