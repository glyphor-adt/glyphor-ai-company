/**
 * Company Memory Store — IMemoryBus implementation
 *
 * Backed by PostgreSQL via @glyphor/shared/db + GCS (large documents).
 * Implements the IMemoryBus interface from @glyphor/agent-runtime.
 */

import { systemQuery, tenantQuery } from '@glyphor/shared/db';
import { Storage } from '@google-cloud/storage';
import { EmbeddingClient } from './embeddingClient.js';
import type {
  IMemoryBus,
  DecisionTier,
  DecisionStatus,
  CompanyDecision,
  ActivityLogEntry,
  ProductMetrics,
  FinancialSnapshot,
  ProductSlug,
  CompanyAgentRole,
  AgentMemory,
  AgentReflection,
  MemoryType,
} from '@glyphor/agent-runtime';
import type {
  DbCompanyProfile,
  DbDecision,
  DbActivityLog,
  DbProduct,
  DbFinancial,
  DbAgentMemory,
  DbAgentReflection,
} from './schema.js';
import { CollectiveIntelligenceStore } from './collectiveIntelligence.js';
import { KnowledgeGraphReader } from './graphReader.js';
import { KnowledgeGraphWriter } from './graphWriter.js';

export interface CompanyMemoryConfig {
  gcsBucket: string;
  gcpProjectId?: string;
  geminiApiKey?: string;
}

export class CompanyMemoryStore implements IMemoryBus {
  private storage: Storage;
  private bucketName: string;
  private embeddingClient: EmbeddingClient | null;
  private _collectiveIntelligence: CollectiveIntelligenceStore | null = null;
  private _graphReader: KnowledgeGraphReader | null = null;
  private _graphWriter: KnowledgeGraphWriter | null = null;

  constructor(config: CompanyMemoryConfig) {
    this.storage = new Storage({ projectId: config.gcpProjectId });
    this.bucketName = config.gcsBucket;
    const geminiKey = config.geminiApiKey ?? process.env.GOOGLE_AI_API_KEY;
    this.embeddingClient = geminiKey ? new EmbeddingClient(geminiKey) : null;
  }

  // ─── GENERIC KEY-VALUE (company_profile table) ──────────────────

  async read<T = unknown>(key: string): Promise<T | null> {
    const rows = await systemQuery<{ value: unknown }>(
      'SELECT value FROM company_profile WHERE key = $1',
      [key],
    );
    if (!rows[0]) return null;
    return rows[0].value as T;
  }

  async write(key: string, value: unknown, agentId: string): Promise<void> {
    await systemQuery(
      `INSERT INTO company_profile (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(value), agentId, new Date().toISOString()],
    );
  }

  // ─── ACTIVITY LOG ───────────────────────────────────────────────

  async appendActivity(entry: ActivityLogEntry): Promise<void> {
    await systemQuery(
      `INSERT INTO activity_log (agent_role, action, product, summary, details, tier, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.agentRole, entry.action, entry.product ?? null, entry.summary, entry.details ?? null, entry.tier ?? 'green', entry.createdAt || new Date().toISOString()],
    );
  }

  async getRecentActivity(hours = 24): Promise<ActivityLogEntry[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const data = await systemQuery<DbActivityLog>(
      'SELECT * FROM activity_log WHERE created_at >= $1 ORDER BY created_at DESC',
      [since],
    );

    return data.map((row) => ({
      agentRole: row.agent_role as ActivityLogEntry['agentRole'],
      action: row.action as ActivityLogEntry['action'],
      product: (row.product as ActivityLogEntry['product']) ?? undefined,
      summary: row.summary,
      details: row.details ?? undefined,
      tier: (row.tier as ActivityLogEntry['tier']) ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // ─── DECISIONS ──────────────────────────────────────────────────

  async createDecision(
    decision: Omit<CompanyDecision, 'id' | 'createdAt'>,
  ): Promise<string> {
    // Prevent deleted/retired agents from filing new approval tickets.
    const SYSTEM_PROPOSERS = new Set(['founder', 'scheduler', 'system', 'kristina', 'andrew']);
    if (!SYSTEM_PROPOSERS.has(decision.proposedBy)) {
      const activeAgent = await systemQuery<{ role: string }>(
        'SELECT role FROM company_agents WHERE role = $1 AND status = $2 LIMIT 1',
        [decision.proposedBy, 'active'],
      );
      if (activeAgent.length === 0) {
        throw new Error(`Decision proposer is not active: ${decision.proposedBy}`);
      }
    }

    // Dedup: each agent may have at most 3 pending decisions.
    const pendingList = await systemQuery<{ id: string; title: string }>(
      "SELECT id, title FROM decisions WHERE proposed_by = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 10",
      [decision.proposedBy],
    );

    if (pendingList.length > 0) {
      const exactMatch = pendingList.find((d) => d.title === decision.title);
      if (exactMatch) return exactMatch.id;
      if (pendingList.length >= 3) return pendingList[0].id;
    }

    const [row] = await systemQuery<{ id: string }>(
      `INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, data, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [decision.tier, decision.status, decision.title, decision.summary, decision.proposedBy, decision.reasoning, JSON.stringify(decision.data ?? null), decision.assignedTo],
    );

    return row.id;
  }

  async getDecisions(filter?: {
    tier?: DecisionTier;
    status?: DecisionStatus;
  }): Promise<CompanyDecision[]> {
    let sql = 'SELECT * FROM decisions WHERE 1=1';
    const params: any[] = [];

    if (filter?.tier) {
      params.push(filter.tier);
      sql += ` AND tier = $${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';

    const data = await systemQuery<DbDecision>(sql, params);
    return data.map(this.mapDecision);
  }

  // ─── PRODUCT METRICS ───────────────────────────────────────────

  async getProductMetrics(slug: ProductSlug): Promise<ProductMetrics | null> {
    const rows = await systemQuery<DbProduct>(
      'SELECT * FROM products WHERE slug = $1',
      [slug],
    );

    if (!rows[0]) return null;

    const product = rows[0];
    const metrics = product.metrics as Record<string, unknown> | null;

    return {
      slug: product.slug as ProductSlug,
      name: product.name,
      status: product.status,
      mrr: metrics?.mrr as number | undefined,
      activeUsers: metrics?.active_users as number | undefined,
      buildsLast7d: metrics?.builds_last_7d as number | undefined,
      buildSuccessRate: metrics?.build_success_rate as number | undefined,
    };
  }

  // ─── FINANCIALS ─────────────────────────────────────────────────

  async getFinancials(days = 30): Promise<FinancialSnapshot[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const data = await systemQuery<DbFinancial>(
      'SELECT * FROM financials WHERE date >= $1 ORDER BY date DESC',
      [since],
    );

    // Group by date+product to build snapshots
    const snapshots = new Map<string, FinancialSnapshot>();

    for (const row of data) {
      const key = `${row.date}-${row.product ?? 'company'}`;
      if (!snapshots.has(key)) {
        snapshots.set(key, {
          date: row.date,
          product: (row.product as ProductSlug) ?? undefined,
          mrr: 0,
          infraCost: 0,
          apiCost: 0,
          margin: 0,
        });
      }
      const snapshot = snapshots.get(key)!;
      switch (row.metric) {
        case 'mrr': snapshot.mrr = row.value; break;
        case 'infra_cost': snapshot.infraCost = row.value; break;
        case 'api_cost': snapshot.apiCost = row.value; break;
        case 'margin': snapshot.margin = row.value; break;
      }
    }

    return Array.from(snapshots.values());
  }

  // ─── GCS OPERATIONS ─────────────────────────────────────────────

  async writeDocument(path: string, content: string): Promise<void> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(path);
    await file.save(content, { contentType: 'text/markdown' });
  }

  async readDocument(path: string): Promise<string | null> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(path);
      const [contents] = await file.download();
      return contents.toString('utf-8');
    } catch {
      return null;
    }
  }

  // ─── AGENT RUN TRACKING ────────────────────────────────────────

  async recordAgentRun(
    role: string,
    durationMs: number,
    costUsd: number,
  ): Promise<void> {
    try {
      await systemQuery(
        'SELECT * FROM record_agent_run($1, $2, $3)',
        [role, durationMs, costUsd],
      );
    } catch {
      // Match record_agent_run RPC: last run fields + increment totals (RPC missing or transient failure)
      await systemQuery(
        `UPDATE company_agents SET
          last_run_at = NOW(),
          last_run_duration_ms = $1,
          last_run_cost_usd = $2,
          total_runs = total_runs + 1,
          total_cost_usd = COALESCE(total_cost_usd, 0) + $2
        WHERE role = $3`,
        [durationMs, costUsd, role],
      );
    }
  }

  async saveLastRunSummary(role: string, summary: string): Promise<void> {
    await systemQuery(
      'UPDATE company_agents SET last_run_summary = $1 WHERE role = $2',
      [summary, role],
    );
  }

  async getLastRunSummary(role: string): Promise<{ summary: string | null; lastRunAt: string | null }> {
    const rows = await systemQuery<{ last_run_summary: string | null; last_run_at: string | null }>(
      'SELECT last_run_summary, last_run_at FROM company_agents WHERE role = $1',
      [role],
    );
    return {
      summary: rows[0]?.last_run_summary ?? null,
      lastRunAt: rows[0]?.last_run_at ?? null,
    };
  }

  // ─── AGENT MEMORY ──────────────────────────────────────────────

  async saveMemory(
    memory: Omit<AgentMemory, 'id' | 'createdAt'>,
  ): Promise<string> {
    const [row] = await systemQuery<{ id: string }>(
      `INSERT INTO agent_memory (agent_role, memory_type, content, importance, source_run_id, tags, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [memory.agentRole, memory.memoryType, memory.content, memory.importance, memory.sourceRunId ?? null, memory.tags ?? [], memory.expiresAt ?? null],
    );
    return row.id;
  }

  async getMemories(
    agentRole: CompanyAgentRole,
    options?: { limit?: number; memoryType?: MemoryType },
  ): Promise<AgentMemory[]> {
    const now = new Date().toISOString();
    let sql = 'SELECT * FROM agent_memory WHERE agent_role = $1 AND (expires_at IS NULL OR expires_at > $2)';
    const params: any[] = [agentRole, now];

    if (options?.memoryType) {
      params.push(options.memoryType);
      sql += ` AND memory_type = $${params.length}`;
    }

    params.push(options?.limit ?? 20);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const data = await systemQuery<DbAgentMemory>(sql, params);

    return data.map((row) => ({
      id: row.id,
      agentRole: row.agent_role as CompanyAgentRole,
      memoryType: row.memory_type as MemoryType,
      content: row.content,
      importance: Number(row.importance),
      sourceRunId: row.source_run_id ?? undefined,
      tags: row.tags,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // ─── AGENT REFLECTIONS ──────────────────────────────────────────

  async saveReflection(
    reflection: Omit<AgentReflection, 'id' | 'createdAt'>,
  ): Promise<string> {
    const [row] = await systemQuery<{ id: string }>(
      `INSERT INTO agent_reflections (agent_role, run_id, summary, quality_score, what_went_well, what_could_improve, prompt_suggestions, knowledge_gaps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [reflection.agentRole, reflection.runId, reflection.summary, reflection.qualityScore, reflection.whatWentWell, reflection.whatCouldImprove, reflection.promptSuggestions, reflection.knowledgeGaps],
    );
    return row.id;
  }

  async getReflections(
    agentRole: CompanyAgentRole,
    limit = 5,
  ): Promise<AgentReflection[]> {
    const data = await systemQuery<DbAgentReflection>(
      'SELECT * FROM agent_reflections WHERE agent_role = $1 ORDER BY created_at DESC LIMIT $2',
      [agentRole, limit],
    );

    return data.map((row) => ({
      id: row.id,
      agentRole: row.agent_role as CompanyAgentRole,
      runId: row.run_id,
      summary: row.summary,
      qualityScore: row.quality_score,
      whatWentWell: row.what_went_well,
      whatCouldImprove: row.what_could_improve,
      promptSuggestions: row.prompt_suggestions,
      knowledgeGaps: row.knowledge_gaps,
      createdAt: row.created_at,
    }));
  }

  async getAverageQualityScore(
    agentRole: CompanyAgentRole,
    days = 7,
  ): Promise<number | null> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const data = await systemQuery<{ quality_score: number }>(
      'SELECT quality_score FROM agent_reflections WHERE agent_role = $1 AND created_at >= $2',
      [agentRole, since],
    );

    if (data.length === 0) return null;

    const sum = data.reduce((s, r) => s + r.quality_score, 0);
    return Math.round(sum / data.length);
  }

  /**
   * Compute and upsert agent_growth rows by comparing recent vs prior reflection scores.
   * Called after each reflection to keep the dashboard GrowthAreas component fed.
   */
  async updateGrowthMetrics(agentRole: CompanyAgentRole): Promise<void> {
    const now = Date.now();
    const recentSince = new Date(now - 7 * 86_400_000).toISOString();
    const priorSince = new Date(now - 30 * 86_400_000).toISOString();

    const [recent, prior] = await Promise.all([
      systemQuery<{ quality_score: number }>(
        'SELECT quality_score FROM agent_reflections WHERE agent_role = $1 AND created_at >= $2',
        [agentRole, recentSince],
      ),
      systemQuery<{ quality_score: number }>(
        'SELECT quality_score FROM agent_reflections WHERE agent_role = $1 AND created_at >= $2 AND created_at < $3',
        [agentRole, priorSince, recentSince],
      ),
    ]);

    if (recent.length === 0) return;

    const avg = (arr: { quality_score: number }[]) =>
      arr.length ? arr.reduce((s, r) => s + r.quality_score, 0) / arr.length : null;

    const recentAvg = avg(recent)!;
    const priorAvg = avg(prior);

    const direction = (curr: number, prev: number | null): string => {
      if (prev === null) return 'stable';
      const delta = curr - prev;
      if (delta > 3) return 'improving';
      if (delta < -3) return 'declining';
      return 'stable';
    };

    const evidence = prior.length > 0
      ? `${recent.length} runs (7d) avg ${recentAvg.toFixed(0)} vs ${prior.length} runs (prior 23d) avg ${priorAvg!.toFixed(0)}`
      : `${recent.length} runs (7d) avg ${recentAvg.toFixed(0)} — no prior data`;

    await systemQuery(
      `INSERT INTO agent_growth (agent_id, dimension, direction, current_value, previous_value, period, evidence, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (agent_id, dimension) DO UPDATE SET
         direction = EXCLUDED.direction, current_value = EXCLUDED.current_value,
         previous_value = EXCLUDED.previous_value, period = EXCLUDED.period,
         evidence = EXCLUDED.evidence, updated_at = EXCLUDED.updated_at`,
      [agentRole, 'quality_score', direction(recentAvg, priorAvg), Math.round(recentAvg * 100) / 100, priorAvg !== null ? Math.round(priorAvg * 100) / 100 : null, '30d', evidence, new Date().toISOString()],
    );
  }

  /**
   * Get the query functions for direct PostgreSQL access.
   */
  getQueryFunctions() {
    return { systemQuery, tenantQuery };
  }

  /**
   * Get the Collective Intelligence store for organizational cognition.
   */
  getCollectiveIntelligence(): CollectiveIntelligenceStore {
    if (!this._collectiveIntelligence) {
      this._collectiveIntelligence = new CollectiveIntelligenceStore(
        this.embeddingClient,
      );
    }
    return this._collectiveIntelligence;
  }

  /**
   * Get the Knowledge Graph reader for connected context retrieval.
   */
  getGraphReader(): KnowledgeGraphReader | null {
    if (!this.embeddingClient) return null;
    if (!this._graphReader) {
      this._graphReader = new KnowledgeGraphReader(this.embeddingClient);
    }
    return this._graphReader;
  }

  /**
   * Get the Knowledge Graph writer for creating nodes and edges.
   */
  getGraphWriter(): KnowledgeGraphWriter | null {
    if (!this.embeddingClient) return null;
    if (!this._graphWriter) {
      this._graphWriter = new KnowledgeGraphWriter(this.embeddingClient);
    }
    return this._graphWriter;
  }

  // ─── PEER FEEDBACK ───────────────────────────────────────────────

  async savePeerFeedback(feedback: {
    fromAgent: string;
    toAgent: string;
    feedback: string;
    context: string;
    sentiment: string;
  }): Promise<void> {
    await systemQuery(
      `INSERT INTO agent_peer_feedback (from_agent, to_agent, feedback, context, sentiment)
       VALUES ($1, $2, $3, $4, $5)`,
      [feedback.fromAgent, feedback.toAgent, feedback.feedback, feedback.context, feedback.sentiment],
    );
  }

  // ─── SEMANTIC MEMORY ────────────────────────────────────────────

  /**
   * Save a memory with an auto-generated embedding vector.
   * Falls back to saving without embedding if the client is unavailable.
   */
  async saveMemoryWithEmbedding(
    memory: Omit<AgentMemory, 'id' | 'createdAt'>,
  ): Promise<string> {
    let embedding: number[] | null = null;
    if (this.embeddingClient) {
      try {
        embedding = await this.embeddingClient.embed(memory.content);
      } catch (err) {
        console.warn('[Memory] Embedding generation failed, saving without vector:', (err as Error).message);
      }
    }

    const [row] = await systemQuery<{ id: string }>(
      `INSERT INTO agent_memory (agent_role, memory_type, content, importance, source_run_id, tags, expires_at${embedding ? ', embedding' : ''})
       VALUES ($1, $2, $3, $4, $5, $6, $7${embedding ? ', $8' : ''}) RETURNING id`,
      [memory.agentRole, memory.memoryType, memory.content, memory.importance, memory.sourceRunId ?? null, memory.tags ?? [], memory.expiresAt ?? null, ...(embedding ? [JSON.stringify(embedding)] : [])],
    );
    return row.id;
  }

  /**
   * Semantic search: find memories similar to a query string.
   * Uses pgvector cosine similarity via the match_memories RPC.
   */
  async searchMemoriesBySimilarity(
    agentRole: CompanyAgentRole,
    query: string,
    options?: { limit?: number; threshold?: number },
  ): Promise<(AgentMemory & { similarity: number })[]> {
    if (!this.embeddingClient) {
      return [];
    }

    const queryEmbedding = await this.embeddingClient.embed(query);

    try {
      const data = await systemQuery<{
        id: string; agent_role: string; memory_type: string; content: string;
        importance: number; tags: string[]; created_at: string; similarity: number;
      }>(
        'SELECT * FROM match_memories($1, $2, $3, $4)',
        [JSON.stringify(queryEmbedding), agentRole, options?.threshold ?? 0.7, options?.limit ?? 10],
      );

      return data.map((row) => ({
        id: row.id,
        agentRole: row.agent_role as CompanyAgentRole,
        memoryType: row.memory_type as MemoryType,
        content: row.content,
        importance: Number(row.importance),
        tags: row.tags,
        createdAt: row.created_at,
        similarity: row.similarity,
      }));
    } catch (err) {
      console.warn('[Memory] Semantic search failed:', (err as Error).message);
      return [];
    }
  }

  // ─── HELPERS ────────────────────────────────────────────────────

  private mapDecision(row: DbDecision): CompanyDecision {
    return {
      id: row.id,
      tier: row.tier,
      status: row.status,
      title: row.title,
      summary: row.summary,
      proposedBy: row.proposed_by as CompanyDecision['proposedBy'],
      reasoning: row.reasoning,
      data: row.data,
      assignedTo: row.assigned_to,
      resolvedBy: row.resolved_by ?? undefined,
      resolutionNote: row.resolution_note ?? undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
    };
  }
}
