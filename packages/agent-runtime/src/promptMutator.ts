/**
 * Prompt Mutator — Applies reflection-generated changes to create new prompt versions.
 *
 * Takes a ReflectionResult and the current active prompt, applies the proposed
 * change, and stages the result as a new version in agent_prompt_versions
 * (deployed_at = NULL — not live until shadow testing promotes it).
 */

import { systemQuery } from '@glyphor/shared/db';
import { getActivePrompt, getLatestVersionNumber } from './activePromptResolver.js';
import type { ReflectionResult } from './reflectionAgent.js';

// ─── Core ───────────────────────────────────────────────────────

/**
 * Apply a reflection mutation and stage the result as a new prompt version.
 * Returns the new version number, or null if mutation failed.
 */
export async function applyMutation(
  agentId: string,
  reflection: ReflectionResult,
): Promise<number | null> {
  const currentPrompt = await getActivePrompt(agentId);
  if (!currentPrompt) {
    console.warn(`[PromptMutator] No active prompt for ${agentId}`);
    return null;
  }

  const newPromptText = applyChange(currentPrompt, reflection.proposed_change, reflection.change_type);
  if (newPromptText === currentPrompt) {
    console.warn(`[PromptMutator] Change had no effect for ${agentId} — skipping`);
    return null;
  }

  const latestVersion = await getLatestVersionNumber(agentId);
  const newVersion = latestVersion + 1;

  await systemQuery(
    `INSERT INTO agent_prompt_versions
     (agent_id, version, prompt_text, change_summary, source, performance_score_at_deploy)
     VALUES ($1, $2, $3, $4, 'reflection', NULL)`,
    [agentId, newVersion, newPromptText, reflection.failure_mode],
  );

  console.log(
    `[PromptMutator] Staged ${agentId} v${newVersion} ` +
    `(${reflection.change_type}: ${reflection.failure_mode.slice(0, 80)})`,
  );

  return newVersion;
}

// ─── Change Application ─────────────────────────────────────────

function applyChange(
  currentPrompt: string,
  proposedChange: string,
  changeType: ReflectionResult['change_type'],
): string {
  switch (changeType) {
    case 'add_instruction':
      return addInstruction(currentPrompt, proposedChange);
    case 'add_example':
      return addExample(currentPrompt, proposedChange);
    case 'clarify_constraint':
      return clarifyConstraint(currentPrompt, proposedChange);
    case 'remove_ambiguity':
      return removeAmbiguity(currentPrompt, proposedChange);
    default:
      return currentPrompt;
  }
}

/**
 * Append a new instruction to the "Critical Constraints" or "Rules" section
 * if one exists, otherwise append at the end of the prompt.
 */
function addInstruction(prompt: string, instruction: string): string {
  // Look for a constraints/rules section to append to
  const constraintPatterns = [
    /(?<=## Critical Constraints\n)([\s\S]*?)(?=\n##|\n---|\Z)/i,
    /(?<=## Rules\n)([\s\S]*?)(?=\n##|\n---|\Z)/i,
    /(?<=## Guidelines\n)([\s\S]*?)(?=\n##|\n---|\Z)/i,
  ];

  for (const pattern of constraintPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      const insertPoint = (match.index ?? 0) + match[0].length;
      return prompt.slice(0, insertPoint) + '\n- ' + instruction + prompt.slice(insertPoint);
    }
  }

  // Fallback: append before the final section break or at the end
  return prompt + '\n\n## Additional Instructions\n- ' + instruction;
}

/**
 * Append an example after an existing examples section, or create one.
 */
function addExample(prompt: string, example: string): string {
  const examplePatterns = [
    /(?<=## Examples?\n)([\s\S]*?)(?=\n##|\n---|\Z)/i,
    /(?<=### Examples?\n)([\s\S]*?)(?=\n##|\n---|\Z)/i,
  ];

  for (const pattern of examplePatterns) {
    const match = prompt.match(pattern);
    if (match) {
      const insertPoint = (match.index ?? 0) + match[0].length;
      return prompt.slice(0, insertPoint) + '\n\n' + example + prompt.slice(insertPoint);
    }
  }

  return prompt + '\n\n## Examples\n' + example;
}

/**
 * Try to find and replace a fuzzy match of the proposed clarification
 * in the prompt. If no match, append as an added instruction.
 */
function clarifyConstraint(prompt: string, clarification: string): string {
  // The proposed_change from reflection might contain a "before → after" format
  const arrowMatch = clarification.match(/^(.+?)\s*(?:→|->|=>)\s*(.+)$/s);
  if (arrowMatch) {
    const before = arrowMatch[1].trim();
    const after = arrowMatch[2].trim();
    if (prompt.includes(before)) {
      return prompt.replace(before, after);
    }
  }

  // Fallback: treat as an added instruction
  return addInstruction(prompt, clarification);
}

/**
 * Remove ambiguous text identified by the reflection agent.
 * If the exact text is found, remove it. Otherwise, no-op.
 */
function removeAmbiguity(prompt: string, textToRemove: string): string {
  if (prompt.includes(textToRemove)) {
    return prompt.replace(textToRemove, '').replace(/\n{3,}/g, '\n\n');
  }
  // Can't find exact text — no-op to avoid corrupting the prompt
  return prompt;
}
