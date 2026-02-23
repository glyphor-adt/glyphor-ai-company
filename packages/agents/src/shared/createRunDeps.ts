/**
 * Shared RunDependencies factory — wires up personality profiles,
 * pending inter-agent messages, dynamic briefs, and collective intelligence
 * context for all agent runners.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlyphorEventBus, RunDependencies, AgentProfileData, CompanyAgentRole, SkillContext, SkillFeedback } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { KnowledgeGraphReader } from '@glyphor/company-memory';

/** Map agent roles to their organizational department for knowledge routing. */
const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  'cto': 'engineering',
  'cfo': 'finance',
  'cpo': 'product',
  'cmo': 'marketing',
  'vp-customer-success': 'customer-success',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'revenue-analyst': 'finance',
  'cost-analyst': 'finance',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'onboarding-specialist': 'customer-success',
  'support-triage': 'customer-success',
  'account-research': 'sales',
  'm365-admin': 'engineering',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'ops': 'operations',
};

export function createRunDeps(
  supabase: SupabaseClient,
  glyphorEventBus: GlyphorEventBus,
  memory: CompanyMemoryStore,
): RunDependencies {
  const ci = memory.getCollectiveIntelligence();
  const graphReader: KnowledgeGraphReader | null = memory.getGraphReader();

  return {
    glyphorEventBus,
    agentMemoryStore: memory,

    agentProfileLoader: async (role: CompanyAgentRole): Promise<AgentProfileData | null> => {
      const { data } = await supabase
        .from('agent_profiles')
        .select('personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, voice_sample, signature, voice_examples')
        .eq('agent_id', role)
        .single();
      return data as AgentProfileData | null;
    },

    pendingMessageLoader: async (role: CompanyAgentRole) => {
      const { data } = await supabase
        .from('agent_messages')
        .select('id, from_agent, message, message_type, priority, thread_id, created_at')
        .eq('to_agent', role)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (data?.length) {
        await supabase
          .from('agent_messages')
          .update({ status: 'read' })
          .in('id', data.map((m: { id: string }) => m.id));
      }
      return data ?? [];
    },

    dynamicBriefLoader: async (agentId: string): Promise<string | null> => {
      const { data } = await supabase
        .from('agent_briefs')
        .select('system_prompt')
        .eq('agent_id', agentId)
        .single();
      return data?.system_prompt ?? null;
    },

    collectiveIntelligenceLoader: async (role: CompanyAgentRole): Promise<string | null> => {
      const department = ROLE_DEPARTMENT[role];
      const parts: string[] = [];

      // Layer 1: Company Pulse
      const pulseCtx = await ci.formatPulseContext();
      if (pulseCtx) parts.push(pulseCtx);

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
      // Load active sections from company_knowledge_base, filtered by department audience
      let query = supabase
        .from('company_knowledge_base')
        .select('section, title, content')
        .eq('is_active', true)
        .order('section');

      if (department) {
        query = query.or(`audience.eq.all,audience.eq.${department}`);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) return '';

      return data
        .map((row: { title: string; content: string }) => `## ${row.title}\n\n${row.content}`)
        .join('\n\n---\n\n');
    },

    bulletinLoader: async (department?: string): Promise<string> => {
      // Load active, non-expired founder bulletins
      let query = supabase
        .from('founder_bulletins')
        .select('created_by, content, priority, created_at')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (department) {
        query = query.or(`audience.eq.all,audience.eq.${department}`);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) return '';

      // Filter out expired bulletins client-side (simpler than complex SQL)
      const now = new Date();
      const active = (data as { created_by: string; content: string; priority: string; created_at: string; expires_at?: string }[])
        .filter(b => !b.expires_at || new Date(b.expires_at) > now);

      if (active.length === 0) return '';

      const entries = active.map(b => {
        const icon = b.priority === 'urgent' ? '🔴' : b.priority === 'important' ? '🟡' : '';
        return `${icon} **From ${b.created_by}:** ${b.content}`.trim();
      });

      return `## 📢 Founder Bulletins\n\n${entries.join('\n\n')}`;
    },

    skillContextLoader: async (role: CompanyAgentRole, task: string): Promise<SkillContext | null> => {
      // 1. Load all skills assigned to this agent with full skill data
      const { data: agentSkills } = await supabase
        .from('agent_skills')
        .select('proficiency, learned_refinements, failure_modes, skill_id')
        .eq('agent_role', role);

      if (!agentSkills || agentSkills.length === 0) return null;

      const skillIds = agentSkills.map((as: { skill_id: string }) => as.skill_id);
      const { data: skills } = await supabase
        .from('skills')
        .select('id, slug, name, category, description, methodology, tools_granted')
        .in('id', skillIds);

      if (!skills || skills.length === 0) return null;

      // 2. Match task against task_skill_map for priority ordering
      const { data: taskMappings } = await supabase
        .from('task_skill_map')
        .select('task_regex, skill_slug, priority');

      const matchedSlugs = new Set<string>();
      if (taskMappings) {
        for (const mapping of taskMappings as { skill_slug: string; priority: number; task_regex: string }[]) {
          try {
            const regex = new RegExp(mapping.task_regex, 'i');
            if (regex.test(task)) {
              matchedSlugs.add(mapping.skill_slug);
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
        methodology: string;
        tools_granted: string[];
      }

      const contextSkills: SkillContext['skills'] = [];
      const seen = new Set<string>();

      // Prioritize matched skills
      for (const skill of skills as SkillRow[]) {
        if (matchedSlugs.has(skill.slug) && !seen.has(skill.id)) {
          const as = agentSkillMap.get(skill.id);
          contextSkills.push({
            slug: skill.slug,
            name: skill.name,
            category: skill.category,
            methodology: skill.methodology,
            proficiency: as?.proficiency ?? 'learning',
            tools_granted: skill.tools_granted ?? [],
            learned_refinements: as?.learned_refinements ?? [],
            failure_modes: as?.failure_modes ?? [],
          });
          seen.add(skill.id);
        }
      }

      // Add remaining skills (limit to top 5 to keep prompt size manageable)
      for (const skill of skills as SkillRow[]) {
        if (!seen.has(skill.id) && contextSkills.length < 5) {
          const as = agentSkillMap.get(skill.id);
          contextSkills.push({
            slug: skill.slug,
            name: skill.name,
            category: skill.category,
            methodology: skill.methodology,
            proficiency: as?.proficiency ?? 'learning',
            tools_granted: skill.tools_granted ?? [],
            learned_refinements: as?.learned_refinements ?? [],
            failure_modes: as?.failure_modes ?? [],
          });
          seen.add(skill.id);
        }
      }

      return contextSkills.length > 0 ? { skills: contextSkills } : null;
    },

    skillFeedbackWriter: async (role: CompanyAgentRole, feedback: SkillFeedback[]): Promise<void> => {
      for (const fb of feedback) {
        // Look up the skill by slug
        const { data: skill } = await supabase
          .from('skills')
          .select('id')
          .eq('slug', fb.skill_slug)
          .single();

        if (!skill) continue;

        // Load current agent_skill record
        const { data: agentSkill } = await supabase
          .from('agent_skills')
          .select('id, times_used, successes, failures, learned_refinements, failure_modes, proficiency')
          .eq('agent_role', role)
          .eq('skill_id', skill.id)
          .single();

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

        await supabase
          .from('agent_skills')
          .update({
            times_used: timesUsed,
            successes,
            failures,
            learned_refinements: refinements,
            failure_modes: failureModes,
            proficiency,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', agentSkill.id);
      }
    },
  };
}

/**
 * Load agent config (model, temperature, max_turns, thinking_enabled) from company_agents table.
 * Falls back to provided defaults if the DB lookup fails or returns null.
 */
export async function loadAgentConfig(
  supabase: SupabaseClient,
  role: string,
  defaults: { model: string; temperature: number; maxTurns: number },
): Promise<{ model: string; temperature: number; maxTurns: number; thinkingEnabled: boolean }> {
  try {
    const { data } = await supabase
      .from('company_agents')
      .select('model, temperature, max_turns, thinking_enabled')
      .eq('role', role)
      .single();

    if (data) {
      return {
        model: data.model || defaults.model,
        temperature: data.temperature ?? defaults.temperature,
        maxTurns: data.max_turns ?? defaults.maxTurns,
        thinkingEnabled: data.thinking_enabled ?? true,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...defaults, thinkingEnabled: true };
}
