/**
 * Shared Memory Loader — Unified cross-agent memory access.
 *
 * Replaces per-agent fragmented memory loading with a 5-layer
 * shared memory architecture:
 *   L1: Working Memory (hot — current cycle state)
 *   L2: Episodic Memory (warm — recent shared episodes)
 *   L3: Semantic Memory (cool — knowledge graph)
 *   L4: Procedural Memory (persistent — proven playbooks)
 *   L5: World Model (meta — per-agent self-model, orchestrators only)
 *
 * All layers are searchable by any agent; no explicit routing needed.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { EmbeddingClient } from './embeddingClient.js';
import type { KnowledgeGraphReader } from './graphReader.js';
import type {
  CompanyAgentRole,
  SharedEpisode,
  SharedProcedure,
  SharedMemoryContext,
  AgentWorldModel,
  EpisodeType,
} from '@glyphor/agent-runtime';

// ─── Role → Domain mapping ──────────────────────────────────────

const ROLE_DOMAINS: Record<string, string[]> = {
  'chief-of-staff': ['operations', 'strategy', 'cross-functional'],
  'ops': ['operations', 'infrastructure', 'monitoring'],
  'cto': ['engineering', 'infrastructure', 'security'],
  'platform-engineer': ['engineering', 'infrastructure'],
  'quality-engineer': ['engineering', 'quality'],
  'devops-engineer': ['engineering', 'infrastructure', 'devops'],
  'cfo': ['finance', 'operations'],
  'clo': ['legal', 'compliance'],
  'revenue-analyst': ['finance', 'revenue'],
  'cost-analyst': ['finance', 'cost'],
  'cpo': ['product', 'strategy'],
  'user-researcher': ['product', 'research'],
  'competitive-intel': ['product', 'competitive'],
  'cmo': ['marketing', 'content'],
  'content-creator': ['marketing', 'content'],
  'seo-analyst': ['marketing', 'seo'],
  'social-media-manager': ['marketing', 'social'],
  'vp-customer-success': ['customer_success', 'support'],
  'onboarding-specialist': ['customer_success', 'onboarding'],
  'support-triage': ['customer_success', 'support'],
  'vp-sales': ['sales', 'revenue'],
  'account-research': ['sales', 'research'],
  'vp-design': ['design', 'product'],
  'ui-ux-designer': ['design', 'ux'],
  'frontend-engineer': ['design', 'engineering'],
  'design-critic': ['design', 'quality'],
  'template-architect': ['design', 'engineering'],
  'global-admin': ['operations', 'security'],
  'm365-admin': ['operations', 'infrastructure'],
  'vp-research': ['research', 'strategy'],
  'competitive-research-analyst': ['research', 'competitive'],
  'market-research-analyst': ['research', 'market'],
  'technical-research-analyst': ['research', 'engineering'],
  'industry-research-analyst': ['research', 'industry'],
};

const ORCHESTRATOR_ROLES = new Set([
  'chief-of-staff', 'vp-research', 'cto', 'clo', 'ops',
]);

type ContextTier = 'light' | 'task' | 'standard' | 'full';

export class SharedMemoryLoader {
  constructor(
    private embedding: EmbeddingClient,
    private graphReader: KnowledgeGraphReader | null = null,
  ) {}

  /**
   * Load shared memory context for an agent run.
   * Context depth scales with the tier.
   */
  async loadForAgent(
    role: CompanyAgentRole,
    task: string,
    contextTier: ContextTier,
  ): Promise<SharedMemoryContext> {
    const domains = ROLE_DOMAINS[role] ?? [];

    // L1: Working Memory — always loaded (lightweight DB queries)
    const workingPromise = this.getWorkingMemory();

    // L2: Episodic Memory — standard+ (semantic search against task)
    const episodePromise = (contextTier !== 'light')
      ? this.searchEpisodes(task, {
          domains,
          limit: contextTier === 'full' ? 10 : 5,
          maxAgeDays: 30,
        })
      : Promise.resolve([] as SharedEpisode[]);

    // L3: Semantic Memory — standard+ (knowledge graph neighborhood)
    const semanticPromise = (contextTier === 'standard' || contextTier === 'full')
      ? this.searchSemanticMemory(task, { limit: 6 })
      : Promise.resolve([] as { title: string; content: string; nodeType: string; similarity: number }[]);

    // L4: Procedural Memory — standard+ (matching procedures)
    const procedurePromise = (contextTier !== 'light')
      ? this.getRelevantProcedures(task, domains)
      : Promise.resolve([] as SharedProcedure[]);

    // L5: World Model — orchestrators only, full tier
    const worldModelPromise = (ORCHESTRATOR_ROLES.has(role) && contextTier === 'full')
      ? this.getWorldModel(role)
      : Promise.resolve(null);

    const [working, episodes, semantic, procedures, worldModel] = await Promise.all([
      workingPromise,
      episodePromise,
      semanticPromise,
      procedurePromise,
      worldModelPromise,
    ]);

    return { working, episodes, semantic, procedures, worldModel };
  }

  // ─── Layer 1: Working Memory ────────────────────────────────

  private async getWorkingMemory(): Promise<SharedMemoryContext['working']> {
    const [countResult, alertResult, pulseResult] = await Promise.all([
      systemQuery<{ count: string }>(
        "SELECT COUNT(*) as count FROM work_assignments WHERE status = ANY($1)",
        [['pending', 'dispatched', 'in_progress']],
      ),
      systemQuery<{ payload: any }>(
        "SELECT payload FROM events WHERE type = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 5",
        ['alert.triggered', new Date(Date.now() - 10 * 60 * 1000).toISOString()],
      ),
      systemQuery<any>(
        'SELECT * FROM company_pulse ORDER BY updated_at DESC LIMIT 1',
      ),
    ]);

    return {
      activeAssignments: Number(countResult[0]?.count ?? 0),
      alerts: alertResult.map((e: any) => e.payload?.message ?? 'Alert'),
      companyPulse: pulseResult[0] ?? undefined,
    };
  }

  // ─── Layer 2: Episodic Memory ───────────────────────────────

  async searchEpisodes(
    query: string,
    options: { domains?: string[]; limit?: number; maxAgeDays?: number } = {},
  ): Promise<SharedEpisode[]> {
    const { domains = [], limit = 5, maxAgeDays = 30 } = options;

    const queryEmb = await this.embedding.embed(query);
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

    const data = await systemQuery(
      'SELECT * FROM match_shared_episodes($1, $2, $3, $4, $5)',
      [JSON.stringify(queryEmb), 0.6, limit, domains.length > 0 ? domains : null, cutoff],
    );

    if (!data.length) return [];

    // Increment access counters (fire-and-forget)
    const ids = data.map((e: any) => e.id);
    if (ids.length > 0) {
      void systemQuery('SELECT * FROM increment_episode_access($1)', [ids]).catch(() => {});
    }

    return data.map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      authorAgent: row.author_agent,
      episodeType: row.episode_type,
      summary: row.summary,
      detail: row.detail,
      outcome: row.outcome,
      confidence: row.confidence,
      domains: row.domains,
      tags: row.tags,
      relatedAgents: row.related_agents,
      directiveId: row.directive_id,
      assignmentId: row.assignment_id,
      timesAccessed: row.times_accessed ?? 0,
      promotedToSemantic: row.promoted_to_semantic ?? false,
      archivedAt: row.archived_at,
    }));
  }

  /**
   * Write an episode to shared memory after a meaningful agent run.
   */
  async writeEpisode(episode: {
    authorAgent: CompanyAgentRole;
    episodeType: EpisodeType;
    summary: string;
    detail?: Record<string, unknown>;
    outcome?: string;
    confidence?: number;
    domains: string[];
    tags?: string[];
    relatedAgents?: string[];
    directiveId?: string;
    assignmentId?: string;
  }): Promise<string | null> {
    const embedding = await this.embedding.embed(episode.summary);

    try {
      const [data] = await systemQuery<{ id: string }>(
        `INSERT INTO shared_episodes (author_agent, episode_type, summary, detail, outcome, confidence, domains, tags, related_agents, directive_id, assignment_id, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [episode.authorAgent, episode.episodeType, episode.summary, JSON.stringify(episode.detail ?? null), episode.outcome ?? null, episode.confidence ?? 0.8, episode.domains, episode.tags ?? [], episode.relatedAgents ?? [], episode.directiveId ?? null, episode.assignmentId ?? null, JSON.stringify(embedding)],
      );
      return data?.id ?? null;
    } catch (err) {
      console.warn('[SharedMemoryLoader] Failed to write episode:', (err as Error).message);
      return null;
    }
  }

  // ─── Layer 3: Semantic Memory (Knowledge Graph) ─────────────

  private async searchSemanticMemory(
    query: string,
    options: { limit?: number } = {},
  ): Promise<{ title: string; content: string; nodeType: string; similarity: number }[]> {
    try {
      if (!this.graphReader) return [];
      const context = await this.graphReader.getRelevantContext(query, 'system', {
        limit: options.limit ?? 6,
        expandHops: 1,
      });
      return context.nodes.map((n) => ({
        title: n.title,
        content: n.content,
        nodeType: n.node_type,
        similarity: n.similarity,
      }));
    } catch {
      return [];
    }
  }

  // ─── Layer 4: Procedural Memory ─────────────────────────────

  private async getRelevantProcedures(
    task: string,
    domains: string[],
  ): Promise<SharedProcedure[]> {
    let sql = "SELECT * FROM shared_procedures WHERE status = 'active'";
    const params: any[] = [];

    if (domains.length > 0) {
      params.push(domains);
      sql += ` AND domain = ANY($${params.length})`;
    }

    sql += ' ORDER BY times_used DESC LIMIT 5';

    const data = await systemQuery(sql, params);

    if (!data.length) return [];

    return data.map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      slug: row.slug,
      name: row.name,
      domain: row.domain,
      description: row.description,
      steps: row.steps,
      preconditions: row.preconditions,
      toolsNeeded: row.tools_needed,
      exampleInput: row.example_input,
      exampleOutput: row.example_output,
      discoveredBy: row.discovered_by,
      validatedBy: row.validated_by,
      sourceEpisodes: row.source_episodes,
      timesUsed: row.times_used ?? 0,
      successRate: row.success_rate,
      version: row.version ?? 1,
      status: row.status,
    }));
  }

  /**
   * Propose a new procedure from a successful agent approach.
   */
  async proposeProcedure(procedure: {
    slug: string;
    name: string;
    domain: string;
    description: string;
    steps: { order: number; instruction: string; tools?: string[] }[];
    preconditions?: string[];
    toolsNeeded?: string[];
    discoveredBy: CompanyAgentRole;
    sourceEpisodes?: string[];
  }): Promise<string | null> {
    const { data, error } = await this.supabase // TODO: remove legacy reference
      .from('shared_procedures')
      .insert({
        slug: procedure.slug,
        name: procedure.name,
        domain: procedure.domain,
        description: procedure.description,
        steps: procedure.steps,
        preconditions: procedure.preconditions ?? [],
        tools_needed: procedure.toolsNeeded ?? [],
        discovered_by: procedure.discoveredBy,
        source_episodes: procedure.sourceEpisodes ?? [],
        status: 'proposed',
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[SharedMemoryLoader] Failed to propose procedure:', error.message);
      return null;
    }
    return data?.id ?? null;
  }

  // ─── Layer 5: World Model ───────────────────────────────────

  async getWorldModel(role: CompanyAgentRole): Promise<AgentWorldModel | null> {
    const { data, error } = await this.supabase
      .from('agent_world_model')
      .select('*')
      .eq('agent_role', role)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      agentRole: data.agent_role,
      updatedAt: data.updated_at,
      strengths: data.strengths ?? [],
      weaknesses: data.weaknesses ?? [],
      blindspots: data.blindspots ?? [],
      preferredApproaches: data.preferred_approaches ?? {},
      failurePatterns: data.failure_patterns ?? [],
      taskTypeScores: data.task_type_scores ?? {},
      toolProficiency: data.tool_proficiency ?? {},
      collaborationMap: data.collaboration_map ?? {},
      lastPredictions: data.last_predictions ?? [],
      predictionAccuracy: data.prediction_accuracy ?? 0.5,
      improvementGoals: data.improvement_goals ?? [],
      rubricVersion: data.rubric_version ?? 1,
    };
  }

  async saveWorldModel(role: CompanyAgentRole, model: Partial<AgentWorldModel>): Promise<void> {
    const { error } = await this.supabase
      .from('agent_world_model')
      .upsert({
        agent_role: role,
        updated_at: new Date().toISOString(),
        strengths: model.strengths ?? [],
        weaknesses: model.weaknesses ?? [],
        blindspots: model.blindspots ?? [],
        preferred_approaches: model.preferredApproaches ?? {},
        failure_patterns: model.failurePatterns ?? [],
        task_type_scores: model.taskTypeScores ?? {},
        tool_proficiency: model.toolProficiency ?? {},
        collaboration_map: model.collaborationMap ?? {},
        last_predictions: model.lastPredictions ?? [],
        prediction_accuracy: model.predictionAccuracy ?? 0.5,
        improvement_goals: model.improvementGoals ?? [],
        rubric_version: model.rubricVersion ?? 1,
      }, { onConflict: 'agent_role' });

    if (error) {
      console.warn('[SharedMemoryLoader] Failed to save world model:', error.message);
    }
  }

  // ─── Rubric Access ──────────────────────────────────────────

  async getRubric(role: string, taskType: string): Promise<{
    dimensions: { name: string; weight: number; levels: Record<string, string> }[];
    passingScore: number;
    excellenceScore: number;
  } | null> {
    const { data, error } = await this.supabase
      .from('role_rubrics')
      .select('*')
      .eq('role', role)
      .eq('task_type', taskType)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      // Fall back to the default rubric
      const { data: fallback } = await this.supabase
        .from('role_rubrics')
        .select('*')
        .eq('role', '_default')
        .eq('task_type', taskType)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (!fallback) return null;
      return {
        dimensions: fallback.dimensions,
        passingScore: fallback.passing_score,
        excellenceScore: fallback.excellence_score,
      };
    }

    return {
      dimensions: data.dimensions,
      passingScore: data.passing_score,
      excellenceScore: data.excellence_score,
    };
  }

  // ─── Prompt Formatting ─────────────────────────────────────

  /**
   * Format shared memory context into a prompt section for injection.
   */
  formatForPrompt(ctx: SharedMemoryContext): string {
    const parts: string[] = [];

    // L1: Working Memory
    parts.push('## Company State (Real-Time)');
    parts.push(`Active assignments: ${ctx.working.activeAssignments}`);
    if (ctx.working.alerts.length > 0) {
      parts.push(`Recent alerts: ${ctx.working.alerts.join('; ')}`);
    }

    // L2: Episodes
    if (ctx.episodes.length > 0) {
      parts.push('\n## Recent Company Episodes');
      parts.push('These are recent events across the company. Use them to avoid redundant work.\n');
      for (const ep of ctx.episodes) {
        const ago = formatTimeAgo(new Date(ep.createdAt));
        parts.push(`- **${ep.episodeType}** by ${ep.authorAgent} (${ago} ago): ${ep.summary}`);
        if (ep.outcome) parts.push(`  Outcome: ${ep.outcome}`);
      }
    }

    // L3: Semantic
    if (ctx.semantic.length > 0) {
      parts.push('\n## Relevant Knowledge (Graph)');
      for (const s of ctx.semantic) {
        parts.push(`- [${s.nodeType}] **${s.title}**: ${s.content.slice(0, 200)}`);
      }
    }

    // L4: Procedures
    if (ctx.procedures.length > 0) {
      parts.push('\n## Applicable Procedures');
      for (const p of ctx.procedures) {
        parts.push(`### ${p.name} (${p.domain})`);
        parts.push(`${p.description}`);
        if (p.successRate != null) parts.push(`Success rate: ${(p.successRate * 100).toFixed(0)}% over ${p.timesUsed} uses`);
        parts.push('Steps:');
        for (const step of p.steps) {
          parts.push(`  ${step.order}. ${step.instruction}`);
        }
      }
    }

    // L5: World Model
    if (ctx.worldModel) {
      parts.push(this.formatWorldModelForPrompt(ctx.worldModel));
    }

    return parts.join('\n');
  }

  formatWorldModelForPrompt(wm: AgentWorldModel): string {
    const parts: string[] = [
      `\n## YOUR SELF-MODEL (updated ${wm.updatedAt})`,
    ];

    if (wm.strengths.length > 0) {
      parts.push('\n### Strengths');
      for (const s of wm.strengths) {
        parts.push(`- ${s.dimension}: ${s.evidence} (confidence: ${(s.confidence * 100).toFixed(0)}%)`);
      }
    }

    if (wm.weaknesses.length > 0) {
      parts.push('\n### Active Growth Areas');
      for (const w of wm.weaknesses) {
        parts.push(`- ${w.dimension}: ${w.evidence}`);
      }
    }

    if (wm.improvementGoals.length > 0) {
      parts.push('\n### Improvement Goals');
      for (const g of wm.improvementGoals) {
        const pct = (g.progress * 100).toFixed(0);
        parts.push(`- ${g.dimension}: ${g.currentScore.toFixed(1)} → target ${g.targetScore.toFixed(1)} (${pct}% progress)`);
        if (g.strategy) parts.push(`  Strategy: ${g.strategy}`);
      }
    }

    if (wm.failurePatterns && wm.failurePatterns.length > 0) {
      parts.push('\n### Failure Patterns (avoid these)');
      for (const fp of wm.failurePatterns) {
        parts.push(`- ${fp.pattern} (occurred ${fp.occurrences}x, last: ${fp.lastSeen})`);
      }
    }

    if (wm.predictionAccuracy > 0) {
      const calibration = wm.predictionAccuracy;
      if (calibration < 0.6) {
        parts.push(`\n### Prediction Calibration`);
        parts.push(`Your self-scores diverge from orchestrator grades. Be more critical in self-assessment.`);
      }
    }

    return parts.join('\n');
  }
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
