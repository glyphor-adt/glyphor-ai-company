/**
 * Dependency Resolver — Reads upstream agent outputs from world state at task start.
 *
 * Each agent pulls its own upstream context directly from world state.
 * This replaces the hub-and-spoke Sarah routing for context delivery.
 */

import { readWorldState, type WorldStateEntry } from './worldStateClient.js';
import { AGENT_DEPENDENCIES } from './agentDependencies.js';

// ─── Core ───────────────────────────────────────────────────────

/**
 * Resolve upstream agent outputs for the given agent.
 * Reads `last_output_{upstreamId}` from the 'agent_output' domain.
 */
export async function resolveUpstreamContext(
  agentId: string,
  customerId: string | null,
): Promise<string> {
  const upstreamAgents = AGENT_DEPENDENCIES[agentId];
  if (!upstreamAgents || upstreamAgents.length === 0) return '';

  const keys = upstreamAgents.map(id => `last_output_${id}`);
  const context = await readWorldState('agent_output', customerId, keys);

  return mergeUpstreamContexts(context, upstreamAgents);
}

// ─── Formatter ──────────────────────────────────────────────────

function mergeUpstreamContexts(
  context: Record<string, WorldStateEntry>,
  upstreamAgents: string[],
): string {
  const entries = upstreamAgents
    .map(id => {
      const key = `last_output_${id}`;
      const entry = context[key];
      if (!entry) return null;
      return { agentId: id, entry };
    })
    .filter((e): e is { agentId: string; entry: WorldStateEntry } => e !== null);

  if (entries.length === 0) return '';

  const lines = ['## Recent Upstream Outputs', ''];

  for (const { agentId, entry } of entries) {
    const staleTag = entry.stale ? ` [STALE]` : '';
    const ageTag = `(${entry.age_minutes} min ago)`;

    lines.push(`### ${agentId}${staleTag} ${ageTag}`);

    const value = entry.value as { summary?: string; task?: string; completed_at?: string } | undefined;
    if (value && typeof value === 'object') {
      if (value.task) lines.push(`Task: ${value.task}`);
      if (value.summary) lines.push(value.summary);
    } else {
      lines.push(String(entry.value));
    }
    lines.push('');
  }

  return lines.join('\n');
}
