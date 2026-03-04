/**
 * Global Admin (Morgan Blake) — Runner Entry Point
 * Reports to Sarah Chen (Chief of Staff). Manages cross-project IAM, secrets, and onboarding.
 */

import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { GLOBAL_ADMIN_SYSTEM_PROMPT } from './systemPrompt.js';
import { createGlobalAdminTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createOpsExtensionTools } from '../shared/opsExtensionTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';

export interface GlobalAdminRunParams {
  task?: 'access_audit' | 'compliance_report' | 'onboarding' | 'read_inbox' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runGlobalAdmin(params: GlobalAdminRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'global-admin', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createGlobalAdminTools(memory),
    ...createMemoryTools(memory),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
    ...createEmailTools(),
    ...createSharePointTools(),
    ...createToolGrantTools('global-admin'),
    ...createOpsExtensionTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'access_audit';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'access_audit':
      initialMessage = 'Run a cross-project access audit across all managed GCP projects. Check for IAM drift, overly broad bindings, disabled service accounts, and any non-founder principals with Owner/Editor roles. Produce a structured audit report.';
      break;
    case 'compliance_report':
      initialMessage = 'Generate a compliance report summarising all active IAM bindings, service accounts, and secret access grants across all managed projects. Flag anything that deviates from least-privilege.';
      break;
    case 'onboarding':
      initialMessage = params.message || 'Review any pending onboarding requests and process them according to the standardized onboarding checklist.';
      break;
    case 'read_inbox':
      initialMessage = params.message || 'Check your email inbox for new messages. Read and process any unread emails — respond to requests, take actions within your authority, and escalate anything outside your scope.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Check the current access posture across all managed GCP projects and report any issues.';
      break;
    default:
      initialMessage = params.message || 'Run a quick access health check across all managed GCP projects.';
  }
  const agentCfg = await loadAgentConfig('global-admin', { temperature: 0.2, maxTurns: 12 });

  const config: AgentConfig = {
    id: `morgan-${task}-${today}`,
    role: 'global-admin',
    systemPrompt: GLOBAL_ADMIN_SYSTEM_PROMPT,
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

  try { await memory.recordAgentRun('global-admin', 0, 0.02); } catch {}
  console.log(`[Morgan] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
