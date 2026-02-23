/**
 * Shared RunDependencies factory — wires up personality profiles,
 * pending inter-agent messages, dynamic briefs, and collective intelligence
 * context for all agent runners.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlyphorEventBus, RunDependencies, AgentProfileData, CompanyAgentRole } from '@glyphor/agent-runtime';
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
  };
}

/**
 * Load agent config (model, temperature, max_turns) from company_agents table.
 * Falls back to provided defaults if the DB lookup fails or returns null.
 */
export async function loadAgentConfig(
  supabase: SupabaseClient,
  role: string,
  defaults: { model: string; temperature: number; maxTurns: number },
): Promise<{ model: string; temperature: number; maxTurns: number }> {
  try {
    const { data } = await supabase
      .from('company_agents')
      .select('model, temperature, max_turns')
      .eq('role', role)
      .single();

    if (data) {
      return {
        model: data.model || defaults.model,
        temperature: data.temperature ?? defaults.temperature,
        maxTurns: data.max_turns ?? defaults.maxTurns,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return defaults;
}
