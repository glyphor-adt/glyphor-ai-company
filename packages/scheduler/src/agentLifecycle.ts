/**
 * Agent Lifecycle Helpers
 *
 * Manages creation, retirement, and cleanup of temporary agents
 * spawned by the Analysis and Simulation engines.
 */

import { systemQuery } from '@glyphor/shared/db';
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
  opts: SpawnAgentOptions,
  glyphorEventBus?: GlyphorEventBus,
): Promise<SpawnedAgent> {
  const agentId = opts.role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ttlDays = opts.ttlDays ?? 1;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(opts.name.trim() || 'Agent')}&radius=50&bold=true`;

  const now = new Date().toISOString();
  const [agent] = await systemQuery<SpawnedAgent>(
    `INSERT INTO company_agents (role, codename, name, display_name, title, department, reports_to, status, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_temporary, is_core, expires_at, spawned_by, spawned_for, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id, role, codename, status`,
    [agentId, opts.name, opts.name, opts.name, opts.spawnedFor, opts.department, opts.reportsTo, 'active',
     opts.model || 'gemini-3-flash-preview', opts.temperature ?? 0.4, opts.maxTurns ?? 8,
     opts.budgetPerRun ?? 0.03, opts.budgetDaily ?? 0.25, opts.budgetMonthly ?? 5,
     true, false, expiresAt, opts.spawnedBy, opts.spawnedFor, now, now],
  );

  // Store the dynamic brief (system prompt)
  try {
    await systemQuery(
      `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id) DO UPDATE SET system_prompt=EXCLUDED.system_prompt, skills=EXCLUDED.skills, tools=EXCLUDED.tools, updated_at=EXCLUDED.updated_at`,
      [agentId, opts.systemPrompt, JSON.stringify([]), JSON.stringify([]), new Date().toISOString()],
    );
  } catch (briefErr) {
    console.error(`[agentLifecycle] Failed to store brief for ${agentId}:`, (briefErr as Error).message);
  }

  // Create agent profile with personality — avatar set separately to avoid overwriting
  try {
    await systemQuery(
      `INSERT INTO agent_profiles (agent_id, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, working_style, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (agent_id) DO UPDATE SET personality_summary=EXCLUDED.personality_summary, backstory=EXCLUDED.backstory, communication_traits=EXCLUDED.communication_traits, quirks=EXCLUDED.quirks, tone_formality=EXCLUDED.tone_formality, emoji_usage=EXCLUDED.emoji_usage, verbosity=EXCLUDED.verbosity, working_style=EXCLUDED.working_style, updated_at=EXCLUDED.updated_at`,
      [agentId,
       `${opts.name} is a focused specialist in ${opts.department} who prioritizes clear recommendations, practical execution steps, and concise communication.`,
       `Provisioned as a specialist to support ${opts.department} with targeted expertise on high-priority initiatives.`,
       JSON.stringify(['clear', 'structured', 'action-oriented']),
       JSON.stringify(['summarizes key decisions before details']),
       0.6, 0.1, 0.45, 'outcome-driven', new Date().toISOString()],
    );
  } catch (profileErr) {
    console.error(`[agentLifecycle] Failed to store profile for ${agentId}:`, (profileErr as Error).message);
  }

  // Set DiceBear avatar only for new profiles (don't overwrite existing PNG avatars)
  await systemQuery(
    'UPDATE agent_profiles SET avatar_url = $1 WHERE agent_id = $2 AND avatar_url IS NULL',
    [avatarUrl, agentId],
  );

  // Log the creation
  await systemQuery(
    'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4)',
    [opts.spawnedBy, 'agent.spawned', `Spawned temporary agent "${opts.name}" (${agentId}) for: ${opts.spawnedFor}`, new Date().toISOString()],
  );

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
  agentId: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await systemQuery(
    'UPDATE company_agents SET status=$1, retired_at=$2, retirement_reason=$3, updated_at=$4 WHERE id=$5',
    ['retired', now, reason, now, agentId],
  );

  // Disable any schedules
  await systemQuery(
    'UPDATE agent_schedules SET enabled=$1 WHERE agent_id=$2',
    [false, agentId],
  );

  await systemQuery(
    'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4)',
    ['system', 'agent.retired', `Retired temporary agent ${agentId}: ${reason}`, now],
  );
}

/**
 * Cleanup all expired temporary agents.
 * Called periodically by cron or Atlas health check.
 */
export async function cleanupExpiredAgents(): Promise<{ retired: number }> {
  const now = new Date().toISOString();

  const expired = await systemQuery<{ id: string }>(
    'SELECT id FROM company_agents WHERE is_temporary = $1 AND status != $2 AND expires_at < $3',
    [true, 'retired', now],
  );

  if (!expired || expired.length === 0) return { retired: 0 };

  for (const agent of expired) {
    await retireTemporaryAgent(agent.id, 'TTL expired');
  }

  return { retired: expired.length };
}
