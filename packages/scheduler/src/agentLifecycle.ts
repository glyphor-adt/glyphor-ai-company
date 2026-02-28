/**
 * Agent Lifecycle Helpers
 *
 * Manages creation, retirement, and cleanup of temporary agents
 * spawned by the Analysis and Simulation engines.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';

export interface SpawnAgentOptions {
  name: string;
  role: string;
  department: string;
  reportsTo: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTurns?: number;
  budgetPerRun?: number;
  budgetDaily?: number;
  budgetMonthly?: number;
  ttlDays?: number;
  spawnedBy: string;       // analysis or simulation ID
  spawnedFor: string;       // purpose description
}

export interface SpawnedAgent {
  id: string;
  role: string;
  codename: string;
  status: string;
}

/**
 * Create a temporary agent for analysis/simulation work.
 * The agent is auto-marked as temporary with an expiration date.
 */
export async function createTemporaryAgent(
  supabase: SupabaseClient,
  opts: SpawnAgentOptions,
  glyphorEventBus?: GlyphorEventBus,
): Promise<SpawnedAgent> {
  const agentId = opts.role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ttlDays = opts.ttlDays ?? 1;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(opts.name.trim() || 'Agent')}&radius=50&bold=true`;

  const { data: agent, error } = await supabase
    .from('company_agents')
    .insert({
      role: agentId,
      codename: opts.name,
      name: opts.name,
      display_name: opts.name,
      title: opts.spawnedFor,
      department: opts.department,
      reports_to: opts.reportsTo,
      status: 'active',
      model: opts.model || 'gemini-3-flash-preview',
      temperature: opts.temperature ?? 0.4,
      max_turns: opts.maxTurns ?? 8,
      budget_per_run: opts.budgetPerRun ?? 0.03,
      budget_daily: opts.budgetDaily ?? 0.25,
      budget_monthly: opts.budgetMonthly ?? 5,
      is_temporary: true,
      is_core: false,
      expires_at: expiresAt,
      spawned_by: opts.spawnedBy,
      spawned_for: opts.spawnedFor,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id, role, codename, status')
    .single();

  if (error) throw new Error(`Failed to spawn agent ${agentId}: ${error.message}`);

  // Store the dynamic brief (system prompt)
  const { error: briefErr } = await supabase.from('agent_briefs').upsert({
    agent_id: agentId,
    system_prompt: opts.systemPrompt,
    skills: [],
    tools: [],
    updated_at: new Date().toISOString(),
  });
  if (briefErr) {
    console.error(`[agentLifecycle] Failed to store brief for ${agentId}:`, briefErr.message);
  }

  // Create agent profile with personality — avatar set separately to avoid overwriting
  const { error: profileErr } = await supabase.from('agent_profiles').upsert({
    agent_id: agentId,
    personality_summary: `${opts.name} is a focused specialist in ${opts.department} who prioritizes clear recommendations, practical execution steps, and concise communication.`,
    backstory: `Provisioned as a specialist to support ${opts.department} with targeted expertise on high-priority initiatives.`,
    communication_traits: ['clear', 'structured', 'action-oriented'],
    quirks: ['summarizes key decisions before details'],
    tone_formality: 0.6,
    emoji_usage: 0.1,
    verbosity: 0.45,
    working_style: 'outcome-driven',
    updated_at: new Date().toISOString(),
  });
  if (profileErr) {
    console.error(`[agentLifecycle] Failed to store profile for ${agentId}:`, profileErr.message);
  }

  // Set DiceBear avatar only for new profiles (don't overwrite existing PNG avatars)
  await supabase.from('agent_profiles')
    .update({ avatar_url: avatarUrl })
    .eq('agent_id', agentId)
    .is('avatar_url', null);

  // Log the creation
  await supabase.from('activity_log').insert({
    agent_id: opts.spawnedBy,
    action: 'agent.spawned',
    detail: `Spawned temporary agent "${opts.name}" (${agentId}) for: ${opts.spawnedFor}`,
    created_at: new Date().toISOString(),
  });

  // Emit agent.spawned event to wake HR for onboarding
  if (glyphorEventBus) {
    try {
      await glyphorEventBus.emit({
        type: 'agent.spawned',
        source: 'system',
        payload: {
          agentRole: agentId,
          name: opts.name,
          title: opts.spawnedFor,
          department: opts.department,
          reportsTo: opts.reportsTo,
          isTemporary: true,
          createdBy: opts.spawnedBy,
        },
        priority: 'normal',
      });
    } catch (e) {
      console.error(`[agentLifecycle] Failed to emit agent.spawned:`, e);
    }
  }

  return agent as SpawnedAgent;
}

/**
 * Retire a temporary agent and record the reason.
 */
export async function retireTemporaryAgent(
  supabase: SupabaseClient,
  agentId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('company_agents')
    .update({
      status: 'retired',
      retired_at: new Date().toISOString(),
      retirement_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId);

  // Disable any schedules
  await supabase
    .from('agent_schedules')
    .update({ enabled: false })
    .eq('agent_id', agentId);

  await supabase.from('activity_log').insert({
    agent_id: 'system',
    action: 'agent.retired',
    detail: `Retired temporary agent ${agentId}: ${reason}`,
    created_at: new Date().toISOString(),
  });
}

/**
 * Cleanup all expired temporary agents.
 * Called periodically by cron or Atlas health check.
 */
export async function cleanupExpiredAgents(
  supabase: SupabaseClient,
): Promise<{ retired: number }> {
  const now = new Date().toISOString();

  const { data: expired } = await supabase
    .from('company_agents')
    .select('id')
    .eq('is_temporary', true)
    .neq('status', 'retired')
    .lt('expires_at', now);

  if (!expired || expired.length === 0) return { retired: 0 };

  for (const agent of expired) {
    await retireTemporaryAgent(supabase, agent.id, 'TTL expired');
  }

  return { retired: expired.length };
}
