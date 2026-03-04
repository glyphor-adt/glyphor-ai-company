/**
 * Head of HR (Jasmine Rivera) — Runner Entry Point
 * Reports to Sarah Chen (Chief of Staff). Manages agent onboarding, workforce audits, and agent lifecycle.
 */

import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { HEAD_OF_HR_SYSTEM_PROMPT } from './systemPrompt.js';
import { createHeadOfHRTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createAccessAuditTools } from '../shared/accessAuditTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createHRTools } from '../shared/hrTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';

export interface HeadOfHRRunParams {
  task?: 'workforce_audit' | 'onboard_agent' | 'retire_agent' | 'read_inbox' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runHeadOfHR(params: HeadOfHRRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'head-of-hr', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createHeadOfHRTools(memory),
    ...createMemoryTools(memory),
    ...createToolGrantTools('head-of-hr'),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
    ...createEmailTools(),
    ...createSharePointTools(),
    ...createAgentCreationTools(),
    ...createAccessAuditTools(),
    ...createAgentDirectoryTools(),
    ...createHRTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'workforce_audit';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'workforce_audit':
      initialMessage = 'Run a full workforce audit. Check every active agent for profile completeness, missing briefs, missing display names, avatar status, org chart placement, and model assignment. Produce a structured compliance report with a score and actionable items.';
      break;
    case 'onboard_agent':
      initialMessage = params.message || 'Check for any recently created agents that may need onboarding validation. Validate their profiles and fix any gaps.';
      break;
    case 'retire_agent':
      initialMessage = params.message || 'Review any pending agent retirement requests and process them appropriately.';
      break;
    case 'read_inbox':
      initialMessage = params.message || 'Check your email inbox for new messages. Read and process any unread emails — respond to onboarding requests, agent profile questions, and escalate anything outside your scope.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Check the overall workforce health and report any agents with incomplete profiles or onboarding issues.';
      break;
    default:
      initialMessage = params.message || 'Run a quick workforce health check across all active agents.';
  }
  const agentCfg = await loadAgentConfig('head-of-hr', { temperature: 0.3, maxTurns: 12 });

  const config: AgentConfig = {
    id: `jasmine-${task}-${today}`,
    role: 'head-of-hr',
    systemPrompt: HEAD_OF_HR_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 300_000,
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const result = await runner.run(
    config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event), memory,
    createRunDeps(glyphorEventBus, memory),
  );

  try { await memory.recordAgentRun('head-of-hr', 0, 0.02); } catch {}
  console.log(`[Jasmine] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
