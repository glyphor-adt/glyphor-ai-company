/**
 * Shared RunDependencies factory — wires up personality profiles,
 * pending inter-agent messages, and dynamic briefs for all agent runners.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlyphorEventBus, RunDependencies, AgentProfileData, CompanyAgentRole } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

export function createRunDeps(
  supabase: SupabaseClient,
  glyphorEventBus: GlyphorEventBus,
  memory: CompanyMemoryStore,
): RunDependencies {
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
