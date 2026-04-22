/**
 * Shared RunDependencies factory — wires up personality profiles,
 * pending inter-agent messages, dynamic briefs, and collective intelligence
 * context for all agent runners.
 */

import { getGoogleAiApiKey } from '@glyphor/shared';


import { systemQuery } from '@glyphor/shared/db';
import type { GlyphorEventBus, RunDependencies, AgentProfileData, CompanyAgentRole, SkillContext, SkillFeedback } from '@glyphor/agent-runtime';
import type { ClassifiedRunDependencies } from '@glyphor/agent-runtime';
import { ORCHESTRATOR_ROLES, getRedisCache, ReasoningEngine, JitContextRetriever, ModelClient, ContextDistiller, RuntimeToolFactory, getActivePrompt } from '@glyphor/agent-runtime';
import { ConstitutionalGovernor, TrustScorer } from '@glyphor/agent-runtime';
import {
  SessionMemoryUpdater,
  getSessionMemoryConfigFromEnv,
  type SessionMemoryStore,
  type SessionMemorySummaryRecord,
} from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { KnowledgeGraphReader } from '@glyphor/company-memory';
import { SharedMemoryLoader, WorldModelUpdater, EmbeddingClient } from '@glyphor/company-memory';
import { REQUIRED_COMPANY_DOCTRINE_SECTIONS } from './collectiveIntelligenceTools.js';

/** Map agent roles to their organizational department for knowledge routing. */
const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  'cto': 'engineering',
  'cfo': 'finance',
  'cpo': 'product',
  'cmo': 'marketing',
  'clo': 'legal',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'vp-research': 'research',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'm365-admin': 'engineering',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'ops': 'operations',
  'platform-intel': 'operations',
  'head-of-hr': 'operations',
  'competitive-research-analyst': 'research',
  'market-research-analyst': 'research',
  'bob-the-tax-pro': 'legal',
  'marketing-intelligence-analyst': 'marketing',
  'adi-rose': 'operations',
};

const SKILL_CONTEXT_MAX_ITEMS = 2;
const SKILL_CONTEXT_MAPPED_BUDGET = 1;
const SKILL_CONTEXT_FALLBACK_BUDGET = 1;
const TASK_KEYWORD_MIN_LENGTH = 4;

/** Resolve {live_ref_key} placeholders in KB section content. */
async function resolveLiveRefs<T extends { content: string }>(sections: T[]): Promise<T[]> {
  // Early exit if no placeholders to resolve
  if (!sections.some(s => s.content.includes('{'))) return sections;
  const refs = await systemQuery<{ key: string; cached_value: string | null }>(
    'SELECT key, cached_value FROM knowledge_live_refs',
  );
  if (!refs || refs.length === 0) return sections;
  const refMap = new Map(refs.map(r => [r.key, r.cached_value ?? '—']));
  return sections.map(s => ({
    ...s,
    content: s.content.replace(
      /\{(\w+)\}/g,
      (match, key: string) => refMap.get(key) ?? match,
    ),
  }));
}

const TASK_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'have', 'will',
  'about', 'after', 'before', 'within', 'without', 'need', 'needs', 'should', 'could',
  'would', 'task', 'tasks', 'work', 'agent', 'run', 'next', 'quarter', 'month', 'week',
]);

const PROFICIENCY_RANK: Record<string, number> = {
  master: 4,
  expert: 3,
  competent: 2,
  learning: 1,
};

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ''))
    .filter((word) => word.length >= TASK_KEYWORD_MIN_LENGTH && !TASK_STOP_WORDS.has(word));
}

function extractTaskKeywords(task: string): string[] {
  return Array.from(new Set(normalizeWords(task))).slice(0, 8);
}

function rankSemanticSkill(keywords: string[], skill: { slug: string; name: string; description?: string; methodology?: string }): number {
  if (keywords.length === 0) return 0;

  const slugText = skill.slug.toLowerCase();
  const nameText = skill.name.toLowerCase();
  const descText = (skill.description ?? '').toLowerCase();
  const methodologyText = (skill.methodology ?? '').toLowerCase();

  let score = 0;
  for (const keyword of keywords) {
    if (slugText.includes(keyword)) score += 3;
    if (nameText.includes(keyword)) score += 3;
    if (descText.includes(keyword)) score += 2;
    if (methodologyText.includes(keyword)) score += 1;
  }

  return score;
}

class PostgresSessionMemoryStore implements SessionMemoryStore {
  private warnedMissingTable = false;

  async getLatest(conversationId: string): Promise<SessionMemorySummaryRecord | null> {
    try {
      const rows = await systemQuery<{
        conversation_id: string;
        session_id: string | null;
        agent_role: string;
        summary_text: string;
        updated_at: string;
        source_turn_count: number;
        source_tool_count: number;
        source_token_estimate: number;
      }>(
        `SELECT conversation_id, session_id, agent_role, summary_text, updated_at, source_turn_count, source_tool_count, source_token_estimate
           FROM conversation_memory_summaries
          WHERE conversation_id = $1
          LIMIT 1`,
        [conversationId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        conversationId: row.conversation_id,
        sessionId: row.session_id ?? undefined,
        agentRole: row.agent_role,
        summaryText: row.summary_text,
        updatedAt: row.updated_at,
        sourceTurnCount: row.source_turn_count,
        sourceToolCount: row.source_tool_count,
        sourceTokenEstimate: row.source_token_estimate,
      };
    } catch (err) {
      this.logMissingTableOnce(err);
      return null;
    }
  }

  async upsert(record: SessionMemorySummaryRecord): Promise<void> {
    try {
      await systemQuery(
        `INSERT INTO conversation_memory_summaries (
           conversation_id,
           session_id,
           agent_role,
           summary_text,
           updated_at,
           source_turn_count,
           source_tool_count,
           source_token_estimate
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (conversation_id) DO UPDATE
           SET session_id = EXCLUDED.session_id,
               agent_role = EXCLUDED.agent_role,
               summary_text = EXCLUDED.summary_text,
               updated_at = EXCLUDED.updated_at,
               source_turn_count = EXCLUDED.source_turn_count,
               source_tool_count = EXCLUDED.source_tool_count,
               source_token_estimate = EXCLUDED.source_token_estimate`,
        [
          record.conversationId,
          record.sessionId ?? null,
          record.agentRole,
          record.summaryText,
          record.updatedAt,
          record.sourceTurnCount,
          record.sourceToolCount,
          record.sourceTokenEstimate,
        ],
      );
    } catch (err) {
      this.logMissingTableOnce(err);
      throw err;
    }
  }

  private logMissingTableOnce(err: unknown): void {
    const pgCode =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined;
    if (pgCode === '42P01' && !this.warnedMissingTable) {
      this.warnedMissingTable = true;
      console.warn(
        '[createRunDeps] conversation_memory_summaries table is missing. Session memory updates are disabled until migration is applied.',
      );
    }
  }
}

export function createRunDeps(
  glyphorEventBus: GlyphorEventBus,
  memory: CompanyMemoryStore,
  overrides?: { systemPromptOverride?: string },
): ClassifiedRunDependencies {
  const ci = memory.getCollectiveIntelligence();
  const graphReader: KnowledgeGraphReader | null = memory.getGraphReader();

  // Build shared memory infrastructure for classified runners
  const embeddingClient = new EmbeddingClient(getGoogleAiApiKey()!);
  if (!graphReader) {
    console.warn('[createRunDeps] Knowledge graph reader unavailable (GOOGLE_AI_API_KEY may be missing from CompanyMemoryStore). L3 semantic memory will be skipped, but world models and episodes still work.');
  }
  const cache = getRedisCache();
  const sharedMemoryLoader = new SharedMemoryLoader(embeddingClient, graphReader, cache);
  const worldModelUpdater = new WorldModelUpdater(sharedMemoryLoader);

  // Redis cache (singleton) + JIT context retriever
  const jitContextRetriever = new JitContextRetriever(embeddingClient, cache);

  // Context distiller — compresses raw JIT results into focused briefings
  const distillerModelClient = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
  });
  const contextDistiller = new ContextDistiller(distillerModelClient, cache);

  // Runtime tool factory — lets agents define new tools mid-run
  const runtimeToolFactory = new RuntimeToolFactory();

  // Constitutional governor — evaluates outputs against agent principles
  const constitutionalGovernor = new ConstitutionalGovernor(distillerModelClient, cache);

  // Trust scorer — tracks agent trust and adjusts effective authority
  const trustScorer = new TrustScorer(cache);
  const sessionMemoryStore = new PostgresSessionMemoryStore();
  const sessionMemoryUpdater = new SessionMemoryUpdater(
    sessionMemoryStore,
    getSessionMemoryConfigFromEnv(),
  );

  // Reasoning engine factory — creates per-agent reasoning engines
  const reasoningEngineFactory = async (agentRole: string) => {
    const config = await ReasoningEngine.loadConfig(agentRole, cache);
    if (!config || !config.enabled) return null;
    const modelClient = new ModelClient({
      geminiApiKey: getGoogleAiApiKey(),    });
    return new ReasoningEngine(modelClient, config, cache);
  };

  return {
    glyphorEventBus,
    agentMemoryStore: memory,
    cache,
    jitContextRetriever,
    contextDistiller,
    runtimeToolFactory,
    reasoningEngineFactory,
    constitutionalGovernor,
    trustScorer,
    sessionMemoryStore,
    sessionMemoryUpdater,

    agentProfileLoader: async (role: CompanyAgentRole): Promise<AgentProfileData | null> => {
      const [data] = await systemQuery<AgentProfileData>('SELECT personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, voice_sample, signature, voice_examples, anti_patterns, working_voice FROM agent_profiles WHERE agent_id = $1', [role]);
      return data ?? null;
    },

    pendingMessageLoader: async (role: CompanyAgentRole) => {
      const data = await systemQuery('SELECT id, from_agent, message, message_type, priority, thread_id, created_at FROM agent_messages WHERE to_agent = $1 AND status = $2 ORDER BY created_at ASC', [role, 'pending']);

      if (data.length) {
        await systemQuery('UPDATE agent_messages SET status = $1 WHERE id = ANY($2)', ['read', data.map((m: { id: string }) => m.id)]);
      }
      return data;
    },

    // 'draft' assignments are excluded — they await plan verification before entering the work loop
    pendingAssignmentLoader: async (role: CompanyAgentRole) => {
      const data = await systemQuery('SELECT id, task_description, task_type, expected_output, priority, status, evaluation, directive_id FROM work_assignments WHERE assigned_to = $1 AND status = ANY($2) ORDER BY priority ASC, created_at ASC', [role, ['pending', 'dispatched', 'needs_revision']]);

      if (!data || data.length === 0) return [];

      // Fetch directive titles for context
      const directiveIds = [...new Set(data.map((a: { directive_id: string }) => a.directive_id))];
      const directives = await systemQuery('SELECT id, title FROM founder_directives WHERE id = ANY($1)', [directiveIds]);

      const directiveMap = new Map(
        (directives ?? []).map((d: { id: string; title: string }) => [d.id, d.title]),
      );

      return data.map((a: { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_id: string }) => ({
        id: a.id,
        task_description: a.task_description,
        task_type: a.task_type,
        expected_output: a.expected_output,
        priority: a.priority,
        status: a.status,
        evaluation: a.evaluation,
        directive_title: directiveMap.get(a.directive_id) ?? null,
      }));
    },

    dynamicBriefLoader: async (agentRole: string): Promise<string | null> => {
      // If a systemPromptOverride is provided, use it directly instead of loading the versioned prompt
      if (overrides?.systemPromptOverride) {
        return overrides.systemPromptOverride;
      }
      // Versioned prompt lookup — replaces agent_briefs.
      // Returns null if no versioned prompt exists; caller falls back to static systemPrompt.ts.
      return getActivePrompt(agentRole);
    },

    collectiveIntelligenceLoader: async (role: CompanyAgentRole): Promise<string | null> => {
      // Fall back to DB lookup for dynamic agents not in the static map
      let department = ROLE_DEPARTMENT[role];
      if (!department) {
        const [agentRow] = await systemQuery('SELECT department FROM company_agents WHERE role = $1', [role]);
        department = agentRow?.department ?? undefined;
      }
      const parts: string[] = [];

      // Layer 1: Company Vitals
      const vitalsCtx = await ci.formatVitalsContext();
      if (vitalsCtx) parts.push(vitalsCtx);

      // Layer 2a: Knowledge Inbox (routed knowledge from colleagues)
      const inboxCtx = await ci.formatKnowledgeInboxContext(role);
      if (inboxCtx) parts.push(inboxCtx);

      // Layer 2b: Organizational Knowledge (cross-functional insights)
      const orgCtx = await ci.formatOrgKnowledgeContext(role, department);
      if (orgCtx) parts.push(orgCtx);

      // Layer 3: Knowledge Graph (connected context, 1-hop expansion)
      if (graphReader) {
        try {
          const graphCtx = await graphReader.getRelevantContext(
            `${role} ${department} current priorities`,
            role,
            { limit: 10, expandHops: 1 },
          );
          if (graphCtx.narrative) {
            parts.push(`## Knowledge Graph Context\n${graphCtx.narrative}`);
          }
        } catch (err) {
          console.warn(`[createRunDeps] Graph context load failed for ${role}:`, (err as Error).message);
        }
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    },

    knowledgeRouter: async (knowledge) => {
      return ci.routeKnowledge(knowledge);
    },

    workingMemoryLoader: async (role: CompanyAgentRole) => {
      return memory.getLastRunSummary(role);
    },

    graphWriter: memory.getGraphWriter() ?? undefined,

    knowledgeBaseLoader: async (department?: string): Promise<string> => {
      // Layer 2: Role context — inject based on audience match
      const params: unknown[] = [];
      let audienceFilter = '';
      if (department) {
        params.push(department);
        audienceFilter = ` AND (audience = 'all' OR audience LIKE '%' || $1 || '%')`;
      } else {
        audienceFilter = ` AND audience = 'all'`;
      }
      const sql = `SELECT section, title, content, is_stale
        FROM company_knowledge_base
        WHERE is_active = true
          AND layer = 2
          AND is_stale = FALSE
          ${audienceFilter}
        ORDER BY section`;
      const data = await systemQuery(sql, params);
      if (data.length === 0) return '';

      const resolved = await resolveLiveRefs(data as { section: string; title: string; content: string; is_stale: boolean }[]);
      return resolved
        .map((row) => `## ${row.title}\n\n${row.content}`)
        .join('\n\n---\n\n');
    },

    bulletinLoader: async (department?: string): Promise<string> => {
      let sql = 'SELECT created_by, content, priority, created_at, expires_at FROM founder_bulletins WHERE is_active = true';
      const params: unknown[] = [];
      if (department) {
        params.push('all', department);
        sql += ` AND (audience = $1 OR audience = $2)`;
      }
      sql += ' ORDER BY priority ASC, created_at DESC';
      const data = await systemQuery(sql, params);
      if (data.length === 0) return '';

      // Filter out expired bulletins client-side (simpler than complex SQL)
      const now = new Date();
      const active = (data as { created_by: string; content: string; priority: string; created_at: string; expires_at?: string }[])
        .filter(b => !b.expires_at || new Date(b.expires_at) > now);

      if (active.length === 0) return '';

      const entries = active.map(b => {
        const icon = b.priority === 'urgent' ? '[URGENT]' : b.priority === 'important' ? '[IMPORTANT]' : '';
        return `${icon} **From ${b.created_by}:** ${b.content}`.trim();
      });

      return `## Founder Bulletins\n\n${entries.join('\n\n')}`;
    },

    doctrineLoader: async (): Promise<string | null> => {
      // Layer 1: Always inject — all agents, every run
      const doctrineRows = await systemQuery(
        `SELECT section, title, content
         FROM company_knowledge_base
         WHERE is_active = true
           AND layer = 1
           AND is_stale = FALSE
         ORDER BY section`,
      );

      if (!doctrineRows || doctrineRows.length === 0) {
        return null;
      }

      const rows = doctrineRows as { section: string; title: string; content: string }[];

      // Validate required doctrine sections are still present
      const activeSections = new Set(rows.map((row) => row.section));
      const missing = REQUIRED_COMPANY_DOCTRINE_SECTIONS.filter((section) => !activeSections.has(section));

      const resolved = await resolveLiveRefs(rows);
      const parts: string[] = resolved.map((row) => `## ${row.title}\n\n${row.content}`);
      if (missing.length > 0) {
        parts.push(
          `## Doctrine Integrity Warning\n\nMissing required active doctrine sections: ${missing.join(', ')}. ` +
          'Escalate to operations and continue using the available doctrine sections as the baseline.',
        );
      }

      return parts.join('\n\n---\n\n');
    },

    skillContextLoader: async (role: CompanyAgentRole, task: string): Promise<SkillContext | null> => {
      // 1. Load all skills assigned to this agent with full skill data
      const agentSkills = await systemQuery('SELECT proficiency, learned_refinements, failure_modes, skill_id FROM agent_skills WHERE agent_role = $1', [role]);

      if (!agentSkills || agentSkills.length === 0) return null;

      const skillIds = agentSkills.map((as: { skill_id: string }) => as.skill_id);
      const skills = await systemQuery('SELECT id, slug, name, category, description, methodology, tools_granted FROM skills WHERE id = ANY($1)', [skillIds]);

      if (!skills || skills.length === 0) return null;

      // 2. Match task against task_skill_map for priority ordering
      const taskMappings = await systemQuery('SELECT task_regex, skill_slug, priority FROM task_skill_map', []);

      const matchedSlugs = new Set<string>();
      const slugPriority = new Map<string, number>();
      if (taskMappings) {
        for (const mapping of taskMappings as { skill_slug: string; priority: number; task_regex: string }[]) {
          try {
            const regex = new RegExp(mapping.task_regex, 'i');
            if (regex.test(task)) {
              matchedSlugs.add(mapping.skill_slug);
              const prev = slugPriority.get(mapping.skill_slug);
              if (prev === undefined || mapping.priority < prev) {
                slugPriority.set(mapping.skill_slug, mapping.priority);
              }
            }
          } catch {
            // Invalid regex — skip
          }
        }
      }

      // 3. Build skill context — matched skills first, then remaining
      const skillMap = new Map(skills.map((s: { id: string }) => [s.id, s]));
      const agentSkillMap = new Map(agentSkills.map((as: { skill_id: string; proficiency?: string; learned_refinements?: string[]; failure_modes?: string[] }) => [as.skill_id, as]));

      interface SkillRow {
        id: string;
        slug: string;
        name: string;
        category: string;
        description: string;
        methodology: string;
        tools_granted: string[];
      }

      const contextSkills: SkillContext['skills'] = [];
      const seen = new Set<string>();

      const proficiencyRank = (skillId: string) => {
        const proficiency = (agentSkillMap.get(skillId)?.proficiency ?? 'learning').toLowerCase();
        return PROFICIENCY_RANK[proficiency] ?? 1;
      };

      const buildContextSkill = (skill: SkillRow) => {
        const as = agentSkillMap.get(skill.id);
        return {
          slug: skill.slug,
          name: skill.name,
          category: skill.category,
          methodology: skill.methodology,
          proficiency: as?.proficiency ?? 'learning',
          tools_granted: skill.tools_granted ?? [],
          learned_refinements: as?.learned_refinements ?? [],
          failure_modes: as?.failure_modes ?? [],
        };
      };

      // 3. Retrieval budget: mapped skills first, then semantic fallback, then strongest remaining.
      const matchedCandidates = (skills as SkillRow[])
        .filter((skill) => matchedSlugs.has(skill.slug))
        .sort((left, right) => {
          const leftPriority = slugPriority.get(left.slug) ?? Number.MAX_SAFE_INTEGER;
          const rightPriority = slugPriority.get(right.slug) ?? Number.MAX_SAFE_INTEGER;
          if (leftPriority !== rightPriority) return leftPriority - rightPriority;
          return proficiencyRank(right.id) - proficiencyRank(left.id);
        })
        .slice(0, SKILL_CONTEXT_MAPPED_BUDGET);

      for (const skill of matchedCandidates) {
        contextSkills.push(buildContextSkill(skill));
        seen.add(skill.id);
      }

      const fallbackSlots = Math.max(0, Math.min(
        SKILL_CONTEXT_FALLBACK_BUDGET,
        SKILL_CONTEXT_MAX_ITEMS - contextSkills.length,
      ));
      if (fallbackSlots > 0) {
        const taskKeywords = extractTaskKeywords(task);
        const semanticFallback = (skills as SkillRow[])
          .filter((skill) => !seen.has(skill.id))
          .map((skill) => ({
            skill,
            semanticScore: rankSemanticSkill(taskKeywords, skill),
            proficiency: proficiencyRank(skill.id),
          }))
          .filter((row) => row.semanticScore > 0)
          .sort((left, right) => {
            if (left.semanticScore !== right.semanticScore) return right.semanticScore - left.semanticScore;
            return right.proficiency - left.proficiency;
          })
          .slice(0, fallbackSlots)
          .map((row) => row.skill);

        for (const skill of semanticFallback) {
          contextSkills.push(buildContextSkill(skill));
          seen.add(skill.id);
        }
      }

      // No backfill — only load skills matched by task regex or semantic match.
      // Unmatched skills stay un-loaded to keep prompt size minimal.

      // VP Design: always surface advanced-web-creation when assigned (web pipeline baseline).
      if (role === 'vp-design') {
        const awc = (skills as SkillRow[]).find((s) => s.slug === 'advanced-web-creation');
        if (awc && agentSkillMap.has(awc.id)) {
          const built = buildContextSkill(awc);
          const rest = contextSkills.filter((s) => s.slug !== 'advanced-web-creation');
          contextSkills.length = 0;
          contextSkills.push(built, ...rest);
        }
      }

      return contextSkills.length > 0 ? { skills: contextSkills.slice(0, SKILL_CONTEXT_MAX_ITEMS) } : null;
    },

    partialProgressSaver: async (assignmentId: string, partialOutput: string, agentRole: CompanyAgentRole, abortReason: string): Promise<void> => {
      // Save partial work so the next run can resume
      await systemQuery('UPDATE work_assignments SET output = $1, status = $2 WHERE id = $3', [partialOutput, 'dispatched', assignmentId]);

      // Notify chief-of-staff about the abort
      await systemQuery('INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, thread_id) VALUES ($1, $2, $3, $4, $5, $6)', [agentRole, 'chief-of-staff', `Assignment ${assignmentId} was aborted (${abortReason}). Partial progress saved. May need re-dispatch or reassignment.`, 'status_update', 'normal', `abort-${assignmentId}`]);
    },

    skillFeedbackWriter: async (role: CompanyAgentRole, feedback: SkillFeedback[]): Promise<void> => {
      for (const fb of feedback) {
        // Look up the skill by slug
        const [skill] = await systemQuery('SELECT id FROM skills WHERE slug = $1', [fb.skill_slug]);

        if (!skill) continue;

        // Load current agent_skill record
        const [agentSkill] = await systemQuery('SELECT id, times_used, successes, failures, learned_refinements, failure_modes, proficiency FROM agent_skills WHERE agent_role = $1 AND skill_id = $2', [role, skill.id]);

        if (!agentSkill) continue;

        // Update counters
        const timesUsed = (agentSkill.times_used ?? 0) + 1;
        const successes = (agentSkill.successes ?? 0) + (fb.outcome === 'success' ? 1 : 0);
        const failures = (agentSkill.failures ?? 0) + (fb.outcome === 'failure' ? 1 : 0);

        // Append refinements and failure modes (dedup, cap at 10)
        const refinements: string[] = [...(agentSkill.learned_refinements ?? [])];
        if (fb.refinement && !refinements.includes(fb.refinement)) {
          refinements.push(fb.refinement);
          if (refinements.length > 10) refinements.shift();
        }

        const failureModes: string[] = [...(agentSkill.failure_modes ?? [])];
        if (fb.failure_mode && !failureModes.includes(fb.failure_mode)) {
          failureModes.push(fb.failure_mode);
          if (failureModes.length > 10) failureModes.shift();
        }

        // Auto-upgrade proficiency based on success rate
        let proficiency = agentSkill.proficiency;
        const successRate = timesUsed > 0 ? successes / timesUsed : 0;
        if (timesUsed >= 20 && successRate >= 0.9) proficiency = 'master';
        else if (timesUsed >= 10 && successRate >= 0.8) proficiency = 'expert';
        else if (timesUsed >= 5 && successRate >= 0.7) proficiency = 'competent';

        await systemQuery('UPDATE agent_skills SET times_used = $1, successes = $2, failures = $3, learned_refinements = $4, failure_modes = $5, proficiency = $6, last_used_at = $7 WHERE id = $8', [timesUsed, successes, failures, refinements, failureModes, proficiency, new Date().toISOString(), agentSkill.id]);
      }
    },

    // ─── World model initialization (for CompanyAgentRunner compat) ───
    initializeWorldModel: (role: CompanyAgentRole) => worldModelUpdater.initializeForAgent(role),

    // ─── Executive orchestration config (directive decomposition authority) ───
    orchestrationConfigLoader: async (role: CompanyAgentRole) => {
      try {
        const [row] = await systemQuery(
          'SELECT executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, max_assignments_per_directive, requires_plan_verification, is_canary FROM executive_orchestration_config WHERE executive_role = $1 AND can_decompose = true',
          [role],
        );
        return row ?? null;
      } catch {
        return null;
      }
    },

    // ─── Shared memory + world model (for classified runners) ───
    sharedMemoryLoader: {
      loadForAgent: (role: CompanyAgentRole, currentTask: string) =>
        sharedMemoryLoader.loadForAgent(role, currentTask, ORCHESTRATOR_ROLES.has(role) ? 'full' : 'standard'),
      formatForPrompt: (ctx) => sharedMemoryLoader.formatForPrompt(ctx),
      writeEpisode: async (episode) => {
        const id = await sharedMemoryLoader.writeEpisode(episode as Parameters<typeof sharedMemoryLoader.writeEpisode>[0]);
        return id ?? '';
      },
      initializeWorldModel: (role: CompanyAgentRole) => worldModelUpdater.initializeForAgent(role),
    },
    worldModelUpdater: {
      updateFromGrade: (grade) => worldModelUpdater.updateFromGrade(
        grade.agentRole,
        {
          runId: 'auto',
          taskType: grade.taskType,
          rubricScores: Object.entries(grade.dimensionScores).map(([dimension, score]) => ({
            dimension,
            selfScore: score,
            evidence: '',
            confidence: 0.5,
          })),
          predictedScore: 0,
          approachUsed: 'unknown',
          wouldChange: '',
          newKnowledge: '',
          blockedBy: null,
        },
        {
          assignmentId: 'auto',
          agentRole: grade.agentRole,
          rubricScores: Object.entries(grade.dimensionScores).map(([dimension, score]) => ({
            dimension,
            orchestratorScore: score,
            evidence: grade.evaluatorFeedback,
            feedback: grade.evaluatorFeedback,
          })),
          weightedTotal: grade.overallScore,
          disposition: 'accept' as const,
        },
        3.0,
      ),
    },
  };
}

/**
 * Load agent config (model, temperature, max_turns, thinking_enabled) from company_agents table.
 * Falls back to DEFAULT_AGENT_MODEL if the DB lookup fails or returns null.
 * When task is provided, applies cost-optimised model routing via optimizeModel().
 */
export async function loadAgentConfig(
  role: string,
  defaults: { temperature: number; maxTurns: number },
  task?: string,
): Promise<{ model: string; temperature: number; maxTurns: number; thinkingEnabled: boolean }> {
  // Lazy import to avoid circular deps
  const { resolveModel } = await import('./createRunner.js');
  const { DEFAULT_AGENT_MODEL } = await import('@glyphor/shared/models');
  try {
    const [data] = await systemQuery('SELECT model, temperature, max_turns, thinking_enabled FROM company_agents WHERE role = $1', [role]);

    if (data) {
      const dbModel = data.model || null;
      const rawTurns = data.max_turns != null ? Number(data.max_turns) : NaN;
      const maxTurns =
        Number.isFinite(rawTurns) && rawTurns > 0
          ? Math.floor(rawTurns)
          : defaults.maxTurns;
      return {
        // Always route through resolveModel (which calls optimizeModel) — picks cheapest tier for the role
        model: resolveModel(role as any, task ?? 'scheduled', DEFAULT_AGENT_MODEL, dbModel),
        temperature: data.temperature ?? defaults.temperature,
        maxTurns,
        thinkingEnabled: data.thinking_enabled ?? true,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return {
    model: resolveModel(role as any, task ?? 'scheduled', DEFAULT_AGENT_MODEL, null),
    temperature: defaults.temperature,
    maxTurns: defaults.maxTurns,
    thinkingEnabled: true,
  };
}
