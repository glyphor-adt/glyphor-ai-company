/**
 * Company Memory Store — IMemoryBus implementation
 *
 * Backed by Supabase (structured queries) + GCS (large documents).
 * Implements the IMemoryBus interface from @glyphor/agent-runtime.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Storage } from '@google-cloud/storage';
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

export interface CompanyMemoryConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  gcsBucket: string;
  gcpProjectId?: string;
}

export class CompanyMemoryStore implements IMemoryBus {
  private supabase: SupabaseClient;
  private storage: Storage;
  private bucketName: string;

  constructor(config: CompanyMemoryConfig) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
    this.storage = new Storage({ projectId: config.gcpProjectId });
    this.bucketName = config.gcsBucket;
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
   * Get the internal Supabase client (for use by GlyphorEventBus).
   */
  getSupabaseClient(): SupabaseClient {
    return this.supabase;
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
