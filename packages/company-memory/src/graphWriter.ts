/**
 * Knowledge Graph Writer — Writes nodes + edges from agent reflections.
 *
 * Post-reflection processor that converts structured graph_operations
 * output into kg_nodes and kg_edges rows. Handles deduplication via
 * semantic similarity threshold (0.92) and flexible node references.
 */

import { systemQuery } from '@glyphor/shared/db';
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

      try {
        const sourceRunId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId) ? runId : null;
        const [data] = await systemQuery<{ id: string }>(
          `INSERT INTO kg_nodes (node_type, title, content, created_by, department, importance, tags, embedding, source_run_id, source_type, metadata, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [node.node_type, node.title, node.content, agentId, node.department ?? null, node.importance ?? 0.5, node.tags ?? [], JSON.stringify(emb), sourceRunId, 'reflection', JSON.stringify(node.metadata ?? {}), node.occurred_at ?? new Date().toISOString()],
        );
        createdNodes.set(i, data.id);
      } catch (err) {
        console.warn(`[KG Writer] Failed to create node "${node.title}":`, (err as Error).message);
        continue;
      }
    }

    // 2. Create edges
    let edgesCreated = 0;
    for (const edge of ops.edges) {
      const sourceId = await this.resolveNodeRef(edge.source, createdNodes);
      const targetId = await this.resolveNodeRef(edge.target, createdNodes);

      if (!sourceId || !targetId) continue;
      if (sourceId === targetId) continue; // no self-edges

      try {
        await systemQuery(
          `INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, created_by, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source_id, target_id, edge_type) DO UPDATE SET
             strength = EXCLUDED.strength, confidence = EXCLUDED.confidence,
             created_by = EXCLUDED.created_by, evidence = EXCLUDED.evidence`,
          [sourceId, targetId, edge.edge_type, edge.strength ?? 0.7, edge.confidence ?? 0.7, agentId, edge.evidence ?? null],
        );
        edgesCreated++;
      } catch { /* skip failed edges */ }
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

    try {
      const [data] = await systemQuery<{ id: string }>(
        `INSERT INTO kg_nodes (node_type, title, content, created_by, department, importance, tags, embedding, source_type, metadata, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [node.node_type, node.title, node.content, agentId, node.department ?? null, node.importance ?? 0.5, node.tags ?? [], JSON.stringify(emb), 'tool', JSON.stringify(node.metadata ?? {}), node.occurred_at ?? new Date().toISOString()],
      );
      return data.id;
    } catch (err) {
      console.warn(`[KG Writer] Failed to create node "${node.title}":`, (err as Error).message);
      return null;
    }
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

    try {
      await systemQuery(
        `INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, created_by, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_id, target_id, edge_type) DO UPDATE SET
           strength = EXCLUDED.strength, confidence = EXCLUDED.confidence,
           created_by = EXCLUDED.created_by, evidence = EXCLUDED.evidence`,
        [sourceId, targetId, edgeType, strength, 0.7, agentId, evidence ?? null],
      );
      return true;
    } catch {
      return false;
    }
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
      const rows = await systemQuery<{ id: string }>(
        'SELECT id FROM kg_nodes WHERE node_type = $1 AND title ILIKE $2 AND status = $3 LIMIT 1',
        ['entity', `%${ref.query}%`, 'active'],
      );
      return rows[0]?.id ?? null;
    }

    if (ref.find_by === 'title_contains') {
      const rows = await systemQuery<{ id: string }>(
        'SELECT id FROM kg_nodes WHERE title ILIKE $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
        [`%${ref.query}%`, 'active'],
      );
      return rows[0]?.id ?? null;
    }

    return null;
  }

  private async findDuplicate(content: string): Promise<{ id: string } | null> {
    const emb = await this.embedding.embed(content);
    const data = await systemQuery<{ id: string }>(
      'SELECT * FROM match_kg_nodes($1, $2, $3)',
      [JSON.stringify(emb), 0.92, 1],
    );
    return data[0] ?? null;
  }

  private async validateNode(nodeId: string): Promise<void> {
    try {
      await systemQuery('SELECT * FROM kg_validate_node($1)', [nodeId]);
    } catch {
      // Fallback: non-atomic update if RPC doesn't exist
      await systemQuery('UPDATE kg_nodes SET updated_at = $1 WHERE id = $2', [new Date().toISOString(), nodeId]);
    }
  }

  // ─── Causal Edge Support (Enhancement 5) ──────────────────────

  /**
   * Create or update a causal edge between two nodes.
   * Sets the causal metadata columns added by the causal_edges migration.
   */
  async upsertCausalEdge(params: {
    agentId: string;
    sourceId: string;
    targetId: string;
    causalConfidence: number;
    causalLag?: string;
    causalMechanism?: string;
    strength?: number;
    evidence?: string;
  }): Promise<boolean> {
    if (params.sourceId === params.targetId) return false;

    try {
      await systemQuery(
        `INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, created_by, evidence, causal_confidence, causal_lag, causal_mechanism)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (source_id, target_id, edge_type) DO UPDATE SET
           strength = EXCLUDED.strength, confidence = EXCLUDED.confidence,
           created_by = EXCLUDED.created_by, evidence = EXCLUDED.evidence,
           causal_confidence = EXCLUDED.causal_confidence, causal_lag = EXCLUDED.causal_lag,
           causal_mechanism = EXCLUDED.causal_mechanism`,
        [params.sourceId, params.targetId, 'CAUSAL_INFLUENCES', params.strength ?? 0.7, params.causalConfidence, params.agentId, params.evidence ?? null, params.causalConfidence, params.causalLag ?? null, params.causalMechanism ?? null],
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update the causal confidence of an existing causal edge
   * (e.g., after counterfactual analysis confirms/weakens the link).
   */
  async updateCausalConfidence(
    sourceId: string,
    targetId: string,
    newConfidence: number,
    mechanism?: string,
  ): Promise<boolean> {
    const clampedConfidence = Math.max(0, Math.min(1, newConfidence));
    try {
      if (mechanism) {
        await systemQuery(
          'UPDATE kg_edges SET causal_confidence = $1, confidence = $1, updated_at = $2, causal_mechanism = $3 WHERE source_id = $4 AND target_id = $5 AND edge_type = $6',
          [clampedConfidence, new Date().toISOString(), mechanism, sourceId, targetId, 'CAUSAL_INFLUENCES'],
        );
      } else {
        await systemQuery(
          'UPDATE kg_edges SET causal_confidence = $1, confidence = $1, updated_at = $2 WHERE source_id = $3 AND target_id = $4 AND edge_type = $5',
          [clampedConfidence, new Date().toISOString(), sourceId, targetId, 'CAUSAL_INFLUENCES'],
        );
      }
      return true;
    } catch {
      return false;
    }
  }
}
