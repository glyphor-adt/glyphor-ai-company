/**
 * Core Tools — The 12 tools every Glyphor agent receives.
 *
 * Re-uses existing factory functions and filters to exactly:
 *   read_my_assignments, submit_assignment_output, flag_assignment_blocker,
 *   send_agent_message, check_messages,
 *   save_memory, recall_memories,
 *   request_tool_access, request_new_tool,
 *   emit_insight, emit_alert,
 *   send_teams_dm
 */

import type { ToolDefinition } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

import { createAssignmentTools } from './assignmentTools.js';
import { createCommunicationTools } from './communicationTools.js';
import { createMemoryTools } from './memoryTools.js';
import { createToolRequestTools } from './toolRequestTools.js';
import { createEventTools } from './eventTools.js';
import { createDmTools } from './dmTools.js';

export const CORE_TOOL_NAMES: Set<string> = new Set([
  // Assignment lifecycle
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  // Communication
  'send_agent_message',
  'check_messages',
  // Memory
  'save_memory',
  'recall_memories',
  // Tool requests
  'request_tool_access',
  'request_new_tool',
  // Events
  'emit_insight',
  'emit_alert',
  // Teams DM
  'send_teams_dm',
]);

export interface CoreToolDeps {
  glyphorEventBus: GlyphorEventBus;
  memory: CompanyMemoryStore;
  schedulerUrl?: string;
}

export function createCoreTools(deps: CoreToolDeps): ToolDefinition[] {
  const all: ToolDefinition[] = [
    ...createAssignmentTools(deps.glyphorEventBus),
    ...createCommunicationTools(deps.glyphorEventBus, deps.schedulerUrl),
    ...createMemoryTools(deps.memory),
    ...createToolRequestTools(),
    ...createEventTools(deps.glyphorEventBus),
    ...createDmTools(),
  ];

  return all.filter((t) => CORE_TOOL_NAMES.has(t.name));
}
