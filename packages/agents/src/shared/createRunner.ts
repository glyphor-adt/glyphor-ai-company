/**
 * Runner factory — selects the correct agent runner based on role and task.
 *
 * - on_demand tasks → CompanyAgentRunner (full context, chat mode)
 * - Orchestrator roles on scheduled/work_loop/event tasks → OrchestratorRunner
 * - Task agent roles on scheduled/work_loop/event tasks → TaskRunner
 */

import {
  CompanyAgentRunner,
  OrchestratorRunner,
  TaskRunner,
  ORCHESTRATOR_ROLES,
  type CompanyAgentRole,
} from '@glyphor/agent-runtime';
import type { ModelClient } from '@glyphor/agent-runtime';

/** Roles that get the Pro model for founder-facing chat. */
const PRO_CHAT_ROLES: ReadonlySet<CompanyAgentRole> = new Set([
  'chief-of-staff', 'cto', 'cfo', 'cpo', 'cmo',
]);

/**
 * Resolve the model for an agent run.
 * Founder-facing executives get gemini-3-pro-preview for on_demand chat;
 * everyone else keeps the default (usually gemini-3-flash-preview).
 */
export function resolveModel(
  role: CompanyAgentRole,
  task: string,
  defaultModel: string,
): string {
  if (task === 'on_demand' && PRO_CHAT_ROLES.has(role)) {
    return 'gemini-3-pro-preview';
  }
  return defaultModel;
}

/**
 * Create the appropriate runner for the given role + task combination.
 */
export function createRunner(
  modelClient: ModelClient,
  role: CompanyAgentRole,
  task: string,
): CompanyAgentRunner | OrchestratorRunner | TaskRunner {
  // On-demand chat always uses CompanyAgentRunner (full context loading)
  if (task === 'on_demand') {
    return new CompanyAgentRunner(modelClient);
  }

  // Orchestrator roles use OrchestratorRunner for structured workflows
  if (ORCHESTRATOR_ROLES.has(role)) {
    return new OrchestratorRunner(modelClient);
  }

  // All other roles use TaskRunner
  return new TaskRunner(modelClient);
}
