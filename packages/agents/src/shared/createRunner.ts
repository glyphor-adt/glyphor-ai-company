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
import { optimizeModel } from '@glyphor/shared/models';

/**
 * Resolve the model for an agent run using the cost optimizer.
 * Picks the cheapest model appropriate for the role's complexity tier.
 * Explicit DB assignments (dashboard overrides) always take priority.
 */
export function resolveModel(
  role: CompanyAgentRole,
  task: string,
  _defaultModel: string,
  dbModel?: string | null,
): string {
  return optimizeModel(role, task, dbModel);
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
