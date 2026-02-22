/**
 * Company Memory Store — IMemoryBus implementation
 *
 * Backed by Supabase (structured queries) + GCS (large documents).
 * Implements the IMemoryBus interface from @glyphor/agent-runtime.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

export interface CompanyMemoryConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  gcsBucket: string;
  gcpProjectId?: string;
  geminiApiKey?: string;
}

export class CompanyMemoryStore implements IMemoryBus {
  private supabase: SupabaseClient;
  private storage: Storage;
  private bucketName: string;
  private embeddingClient: EmbeddingClient | null;
  private _collectiveIntelligence: CollectiveIntelligenceStore | null = null;

  constructor(config: CompanyMemoryConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
    this.storage = new Storage({ projectId: config.gcpProjectId });
    this.bucketName = config.gcsBucket;
    const geminiKey = config.geminiApiKey ?? process.env.GOOGLE_AI_API_KEY;
    this.embeddingClient = geminiKey ? new EmbeddingClient(geminiKey) : null;
  }

  // ─── GENERIC KEY-VALUE (company_profile table) ──────────────────

  async read<T = unknown>(key: string): Promise<T | null> {
    const { data, error } = await this.supabase
      .from('company_profile')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) return null;
    return data.value as T;
  }

  async write(key: string, value: unknown, agentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('company_profile')
      .upsert(
        {
          key,
          value,
          updated_by: agentId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );

    if (error) {
      throw new Error(`Memory write failed for key "${key}": ${error.message}`);
    }
  }

  // ─── ACTIVITY LOG ───────────────────────────────────────────────

  async appendActivity(entry: ActivityLogEntry): Promise<void> {
    const { error } = await this.supabase
      .from('activity_log')
      .insert({
        agent_role: entry.agentRole,
        action: entry.action,
        product: entry.product ?? null,
        summary: entry.summary,
        details: entry.details ?? null,
        tier: entry.tier ?? 'green',
        created_at: entry.createdAt || new Date().toISOString(),
      });

    if (error) {
      throw new Error(`Activity log append failed: ${error.message}`);
    }
  }

  async getRecentActivity(hours = 24): Promise<ActivityLogEntry[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('activity_log')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Activity log query failed: ${error.message}`);
    }

    return (data as DbActivityLog[]).map((row) => ({
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
    const { data, error } = await this.supabase
      .from('decisions')
      .insert({
        tier: decision.tier,
        status: decision.status,
        title: decision.title,
        summary: decision.summary,
        proposed_by: decision.proposedBy,
        reasoning: decision.reasoning,
        data: decision.data ?? null,
        assigned_to: decision.assignedTo,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Decision creation failed: ${error?.message}`);
    }

    return data.id;
  }

  async getDecisions(filter?: {
    tier?: DecisionTier;
    status?: DecisionStatus;
  }): Promise<CompanyDecision[]> {
    let query = this.supabase
      .from('decisions')
      .select('*')
      .order('created_at', { ascending: false });

    if (filter?.tier) {
      query = query.eq('tier', filter.tier);
    }
    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Decision query failed: ${error.message}`);
    }

    return (data as DbDecision[]).map(this.mapDecision);
  }

  // ─── PRODUCT METRICS ───────────────────────────────────────────

  async getProductMetrics(slug: ProductSlug): Promise<ProductMetrics | null> {
    const { data, error } = await this.supabase
      .from('products')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error || !data) return null;

    const product = data as DbProduct;
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

    const { data, error } = await this.supabase
      .from('financials')
      .select('*')
      .gte('date', since)
      .order('date', { ascending: false });

    if (error) {
      throw new Error(`Financials query failed: ${error.message}`);
    }

    // Group by date+product to build snapshots
    const snapshots = new Map<string, FinancialSnapshot>();

    for (const row of data as DbFinancial[]) {
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
    const { error } = await this.supabase.rpc('record_agent_run', {
      p_role: role,
      p_duration_ms: durationMs,
      p_cost_usd: costUsd,
    });

    // Fall back to direct update if RPC doesn't exist yet
    if (error) {
      await this.supabase
        .from('company_agents')
        .update({
          last_run_at: new Date().toISOString(),
          last_run_duration_ms: durationMs,
          last_run_cost_usd: costUsd,
        })
        .eq('role', role);
    }
  }

  async saveLastRunSummary(role: string, summary: string): Promise<void> {
    await this.supabase
      .from('company_agents')
      .update({ last_run_summary: summary })
      .eq('role', role);
  }

  async getLastRunSummary(role: string): Promise<{ summary: string | null; lastRunAt: string | null }> {
    const { data } = await this.supabase
      .from('company_agents')
      .select('last_run_summary, last_run_at')
      .eq('role', role)
      .single();
    return {
      summary: data?.last_run_summary ?? null,
      lastRunAt: data?.last_run_at ?? null,
    };
  }

  // ─── AGENT MEMORY ──────────────────────────────────────────────

  async saveMemory(
    memory: Omit<AgentMemory, 'id' | 'createdAt'>,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_memory')
      .insert({
        agent_role: memory.agentRole,
        memory_type: memory.memoryType,
        content: memory.content,
        importance: memory.importance,
        source_run_id: memory.sourceRunId ?? null,
        tags: memory.tags ?? [],
        expires_at: memory.expiresAt ?? null,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Memory save failed: ${error?.message}`);
    }
    return data.id;
  }

  async getMemories(
    agentRole: CompanyAgentRole,
    options?: { limit?: number; memoryType?: MemoryType },
  ): Promise<AgentMemory[]> {
    let query = this.supabase
      .from('agent_memory')
      .select('*')
      .eq('agent_role', agentRole)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? 20);

    if (options?.memoryType) {
      query = query.eq('memory_type', options.memoryType);
    }

    // Exclude expired memories
    query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Memory query failed: ${error.message}`);
    }

    return (data as DbAgentMemory[]).map((row) => ({
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
    const { data, error } = await this.supabase
      .from('agent_reflections')
      .insert({
        agent_role: reflection.agentRole,
        run_id: reflection.runId,
        summary: reflection.summary,
        quality_score: reflection.qualityScore,
        what_went_well: reflection.whatWentWell,
        what_could_improve: reflection.whatCouldImprove,
        prompt_suggestions: reflection.promptSuggestions,
        knowledge_gaps: reflection.knowledgeGaps,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Reflection save failed: ${error?.message}`);
    }
    return data.id;
  }

  async getReflections(
    agentRole: CompanyAgentRole,
    limit = 5,
  ): Promise<AgentReflection[]> {
    const { data, error } = await this.supabase
      .from('agent_reflections')
      .select('*')
      .eq('agent_role', agentRole)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Reflection query failed: ${error.message}`);
    }

    return (data as DbAgentReflection[]).map((row) => ({
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

    const { data, error } = await this.supabase
      .from('agent_reflections')
      .select('quality_score')
      .eq('agent_role', agentRole)
      .gte('created_at', since);

    if (error || !data || data.length === 0) return null;

    const sum = data.reduce((s, r) => s + (r.quality_score as number), 0);
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

    const [recentRes, priorRes] = await Promise.all([
      this.supabase
        .from('agent_reflections')
        .select('quality_score')
        .eq('agent_role', agentRole)
        .gte('created_at', recentSince),
      this.supabase
        .from('agent_reflections')
        .select('quality_score')
        .eq('agent_role', agentRole)
        .gte('created_at', priorSince)
        .lt('created_at', recentSince),
    ]);

    const recent = recentRes.data ?? [];
    const prior = priorRes.data ?? [];
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

    await this.supabase
      .from('agent_growth')
      .upsert({
        agent_id: agentRole,
        dimension: 'quality_score',
        direction: direction(recentAvg, priorAvg),
        current_value: Math.round(recentAvg * 100) / 100,
        previous_value: priorAvg !== null ? Math.round(priorAvg * 100) / 100 : null,
        period: '30d',
        evidence,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_id,dimension' });
  }

  /**
   * Get the internal Supabase client (for use by GlyphorEventBus).
   */
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Get the Collective Intelligence store for organizational cognition.
   */
  getCollectiveIntelligence(): CollectiveIntelligenceStore {
    if (!this._collectiveIntelligence) {
      this._collectiveIntelligence = new CollectiveIntelligenceStore(
        this.supabase,
        this.embeddingClient,
      );
    }
    return this._collectiveIntelligence;
  }

  // ─── PEER FEEDBACK ───────────────────────────────────────────────

  async savePeerFeedback(feedback: {
    fromAgent: string;
    toAgent: string;
    feedback: string;
    context: string;
    sentiment: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('agent_peer_feedback')
      .insert({
        from_agent: feedback.fromAgent,
        to_agent: feedback.toAgent,
        feedback: feedback.feedback,
        context: feedback.context,
        sentiment: feedback.sentiment,
      });

    if (error) {
      throw new Error(`Peer feedback save failed: ${error.message}`);
    }
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

    const { data, error } = await this.supabase
      .from('agent_memory')
      .insert({
        agent_role: memory.agentRole,
        memory_type: memory.memoryType,
        content: memory.content,
        importance: memory.importance,
        source_run_id: memory.sourceRunId ?? null,
        tags: memory.tags ?? [],
        expires_at: memory.expiresAt ?? null,
        ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Memory save (embedded) failed: ${error?.message}`);
    }
    return data.id;
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

    const { data, error } = await this.supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_role: agentRole,
      match_threshold: options?.threshold ?? 0.7,
      match_count: options?.limit ?? 10,
    });

    if (error) {
      console.warn('[Memory] Semantic search failed:', error.message);
      return [];
    }

    return (data ?? []).map((row: { id: string; agent_role: string; memory_type: string; content: string; importance: number; tags: string[]; created_at: string; similarity: number }) => ({
      id: row.id,
      agentRole: row.agent_role as CompanyAgentRole,
      memoryType: row.memory_type as MemoryType,
      content: row.content,
      importance: Number(row.importance),
      tags: row.tags,
      createdAt: row.created_at,
      similarity: row.similarity,
    }));
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
