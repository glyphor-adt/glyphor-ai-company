/**
 * Knowledge Graph Writer — Writes nodes + edges from agent reflections.
 *
 * Post-reflection processor that converts structured graph_operations
 * output into kg_nodes and kg_edges rows. Handles deduplication via
 * semantic similarity threshold (0.92) and flexible node references.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingClient } from './embeddingClient.js';

// ─── Types ────────────────────────────────────────────────────────

export interface GraphNodeInput {
  node_type: string;
  title: string;
  content: string;
  tags?: string[];
  department?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export type NodeRef =
  | { this_run_node: number }
  | { find_by: 'entity' | 'title_contains'; query: string }
  | { node_id: string };

export interface GraphEdgeInput {
  source: NodeRef;
  target: NodeRef;
  edge_type: string;
  strength?: number;
  confidence?: number;
  evidence?: string;
}

export interface GraphOperations {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
}

export interface GraphWriteResult {
  nodesCreated: number;
  edgesCreated: number;
}

// ─── Writer ───────────────────────────────────────────────────────

export class KnowledgeGraphWriter {
  constructor(
    private supabase: SupabaseClient,
    private embedding: EmbeddingClient,
  ) {}

  async processGraphOps(
    agentId: string,
    runId: string,
    ops: GraphOperations,
  ): Promise<GraphWriteResult> {
    const createdNodes = new Map<number, string>(); // index → node_id

    // 1. Create nodes
    for (let i = 0; i < ops.nodes.length; i++) {
      const node = ops.nodes[i];

      // Check for near-duplicate (semantic similarity > 0.92)
      const duplicate = await this.findDuplicate(node.content);
      if (duplicate) {
        await this.validateNode(duplicate.id);
        createdNodes.set(i, duplicate.id);
        continue;
      }

      const emb = await this.embedding.embed(
        `${node.title}. ${node.content}`,
      );

      const { data, error } = await this.supabase
        .from('kg_nodes')
        .insert({
          node_type: node.node_type,
          title: node.title,
          content: node.content,
          created_by: agentId,
          department: node.department ?? null,
          importance: node.importance ?? 0.5,
          tags: node.tags ?? [],
          embedding: JSON.stringify(emb),
          source_run_id: runId,
          source_type: 'reflection',
          metadata: node.metadata ?? {},
          occurred_at: node.occurred_at ?? new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        console.warn(`[KG Writer] Failed to create node "${node.title}":`, error.message);
        continue;
      }
      createdNodes.set(i, data!.id);
    }

    // 2. Create edges
    let edgesCreated = 0;
    for (const edge of ops.edges) {
      const sourceId = await this.resolveNodeRef(edge.source, createdNodes);
      const targetId = await this.resolveNodeRef(edge.target, createdNodes);

      if (!sourceId || !targetId) continue;
      if (sourceId === targetId) continue; // no self-edges

      const { error } = await this.supabase.from('kg_edges').upsert(
        {
          source_id: sourceId,
          target_id: targetId,
          edge_type: edge.edge_type,
          strength: edge.strength ?? 0.7,
          confidence: edge.confidence ?? 0.7,
          created_by: agentId,
          evidence: edge.evidence ?? null,
        },
        { onConflict: 'source_id,target_id,edge_type' },
      );

      if (!error) edgesCreated++;
    }

    return { nodesCreated: createdNodes.size, edgesCreated };
  }

  /**
   * Create a single node (used by agent tools).
   */
  async createNode(
    agentId: string,
    node: GraphNodeInput,
  ): Promise<string | null> {
    const duplicate = await this.findDuplicate(node.content);
    if (duplicate) {
      await this.validateNode(duplicate.id);
      return duplicate.id;
    }

    const emb = await this.embedding.embed(`${node.title}. ${node.content}`);

    const { data, error } = await this.supabase
      .from('kg_nodes')
      .insert({
        node_type: node.node_type,
        title: node.title,
        content: node.content,
        created_by: agentId,
        department: node.department ?? null,
        importance: node.importance ?? 0.5,
        tags: node.tags ?? [],
        embedding: JSON.stringify(emb),
        source_type: 'tool',
        metadata: node.metadata ?? {},
        occurred_at: node.occurred_at ?? new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.warn(`[KG Writer] Failed to create node "${node.title}":`, error.message);
      return null;
    }
    return data!.id;
  }

  /**
   * Create a single edge (used by agent tools).
   */
  async createEdge(
    agentId: string,
    sourceId: string,
    targetId: string,
    edgeType: string,
    strength = 0.7,
    evidence?: string,
  ): Promise<boolean> {
    if (sourceId === targetId) return false;

    const { error } = await this.supabase.from('kg_edges').upsert(
      {
        source_id: sourceId,
        target_id: targetId,
        edge_type: edgeType,
        strength,
        confidence: 0.7,
        created_by: agentId,
        evidence: evidence ?? null,
      },
      { onConflict: 'source_id,target_id,edge_type' },
    );
    return !error;
  }

  // ─── Private Helpers ────────────────────────────────────────────

  private async resolveNodeRef(
    ref: NodeRef,
    runNodes: Map<number, string>,
  ): Promise<string | null> {
    if ('this_run_node' in ref) {
      return runNodes.get(ref.this_run_node) ?? null;
    }

    if ('node_id' in ref) {
      return ref.node_id;
    }

    if (ref.find_by === 'entity') {
      const { data } = await this.supabase
        .from('kg_nodes')
        .select('id')
        .eq('node_type', 'entity')
        .ilike('title', `%${ref.query}%`)
        .eq('status', 'active')
        .limit(1)
        .single();
      return data?.id ?? null;
    }

    if (ref.find_by === 'title_contains') {
      const { data } = await this.supabase
        .from('kg_nodes')
        .select('id')
        .ilike('title', `%${ref.query}%`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      return data?.id ?? null;
    }

    return null;
  }

  private async findDuplicate(content: string): Promise<{ id: string } | null> {
    const emb = await this.embedding.embed(content);
    const { data } = await this.supabase.rpc('match_kg_nodes', {
      query_embedding: JSON.stringify(emb),
      match_threshold: 0.92,
      match_count: 1,
    });
    return data?.[0] ?? null;
  }

  private async validateNode(nodeId: string): Promise<void> {
    // Increment times_validated atomically
    await this.supabase.rpc('kg_validate_node', { target_node_id: nodeId }).catch(() => {
      // Fallback: non-atomic update if RPC doesn't exist
      this.supabase
        .from('kg_nodes')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', nodeId);
    });
  }
}
