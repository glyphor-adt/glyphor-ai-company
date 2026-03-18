/**
 * Active Prompt Resolver — Single source of truth for versioned agent prompts.
 *
 * All agent runners should call getActivePrompt() instead of reading prompts
 * from static config or agent_briefs. This is the switch that makes prompt
 * versioning live and enables the self-improvement pipeline.
 */

import { systemQuery } from '@glyphor/shared/db';

export interface PromptVersionRow {
  prompt_text: string;
  version: number;
  source: string;
  deployed_at: string;
}

/**
 * Returns the currently active (deployed, non-retired) prompt text for an agent.
 * Falls back to null if no versioned prompt exists — callers should use the
 * static systemPrompt.ts constant as ultimate fallback.
 */
export async function getActivePrompt(agentId: string): Promise<string | null> {
  const rows = await systemQuery<PromptVersionRow>(
    `SELECT prompt_text FROM agent_prompt_versions
     WHERE agent_id = $1 AND deployed_at IS NOT NULL AND retired_at IS NULL
     ORDER BY deployed_at DESC LIMIT 1`,
    [agentId],
  );
  return rows[0]?.prompt_text ?? null;
}

/**
 * Returns the prompt text for a specific version number.
 */
export async function getPromptVersion(agentId: string, version: number): Promise<string> {
  const rows = await systemQuery<{ prompt_text: string }>(
    `SELECT prompt_text FROM agent_prompt_versions
     WHERE agent_id = $1 AND version = $2`,
    [agentId, version],
  );
  if (rows.length === 0) throw new Error(`No prompt version ${version} found for agent ${agentId}`);
  return rows[0].prompt_text;
}

/**
 * Returns the version number of the currently active prompt.
 */
export async function getCurrentVersionNumber(agentId: string): Promise<number> {
  const rows = await systemQuery<{ version: number }>(
    `SELECT version FROM agent_prompt_versions
     WHERE agent_id = $1 AND deployed_at IS NOT NULL AND retired_at IS NULL
     ORDER BY deployed_at DESC LIMIT 1`,
    [agentId],
  );
  if (rows.length === 0) throw new Error(`No active prompt version for agent ${agentId}`);
  return rows[0].version;
}

/**
 * Returns the highest version number for an agent (active or not).
 */
export async function getLatestVersionNumber(agentId: string): Promise<number> {
  const rows = await systemQuery<{ max_version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS max_version FROM agent_prompt_versions WHERE agent_id = $1`,
    [agentId],
  );
  return rows[0].max_version;
}
