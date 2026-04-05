/**
 * Core Tools — Shared defaults every active Glyphor agent receives.
 *
 * Re-uses existing factory functions and filters to exactly:
 *   read_my_assignments, submit_assignment_output, flag_assignment_blocker,
 *   send_agent_message, check_messages,
 *   save_memory, recall_memories,
 *   request_tool_access, request_new_tool, list_my_tools, check_tool_access, tool_search,
 *   emit_insight, emit_alert,
 *   send_teams_dm, read_teams_dm,
 *   post_to_briefings, post_to_deliverables
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
import { createDeliverableTools } from './deliverableTools.js';
import { createPdfTools, createWordTools } from './documentTools.js';
import { createExternalA2aTools } from './externalA2aTools.js';
import { createKnowledgeRetrievalTools } from './knowledgeRetrievalTools.js';
import { createChannelNotifyTools } from './channelNotifyTools.js';
import { createSlackOutputTools } from './slackOutputTools.js';

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
  'list_my_tools',
  'check_tool_access',
  'tool_search',
  // Events
  'emit_insight',
  'emit_alert',
  // Teams DM
  'send_teams_dm',
  'read_teams_dm',
  // Channel updates
  'post_to_briefings',
  'post_to_deliverables',
  // Slack customer output
  'post_to_slack',
  'request_slack_approval',
  // Shared artifacts
  'publish_deliverable',
  'get_deliverables',
  // PDF generation
  'generate_pdf',
  // Word document generation
  'generate_word_doc',
  // External discovery
  'discover_external_agents',
  // Knowledge retrieval
  'read_company_knowledge',
]);

export interface CoreToolDeps {
  glyphorEventBus: GlyphorEventBus;
  memory: CompanyMemoryStore;
  schedulerUrl?: string;
  externalA2aRegistryUrl?: string;
}

/** Minimal tool set for on_demand/chat — just memory and communication. */
export const CHAT_CORE_TOOL_NAMES: Set<string> = new Set([
  'save_memory',
  'recall_memories',
  'send_agent_message',
  'check_messages',
  'read_company_knowledge',
  'generate_pdf',
  'generate_word_doc',
]);

export function createCoreTools(deps: CoreToolDeps, opts?: { chatOnly?: boolean }): ToolDefinition[] {
  const all: ToolDefinition[] = [
    ...createAssignmentTools(deps.glyphorEventBus),
    ...createCommunicationTools(deps.glyphorEventBus, deps.schedulerUrl),
    ...createMemoryTools(deps.memory),
    ...createToolRequestTools(),
    ...createEventTools(deps.glyphorEventBus),
    ...createDmTools(),
    ...createChannelNotifyTools(),
    ...createSlackOutputTools(),
    ...createDeliverableTools(deps.glyphorEventBus),
    ...createPdfTools(),
    ...createWordTools(),
    ...createExternalA2aTools(deps.externalA2aRegistryUrl ?? process.env.A2A_REGISTRY_URL),
    ...createKnowledgeRetrievalTools(),
  ];

  const nameSet = opts?.chatOnly ? CHAT_CORE_TOOL_NAMES : CORE_TOOL_NAMES;
  return all.filter((t) => nameSet.has(t.name));
}
