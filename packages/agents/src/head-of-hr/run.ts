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
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createAccessAuditTools } from '../shared/accessAuditTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createEntraHRTools } from '../shared/entraHRTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface HeadOfHRRunParams {
  task?: 'workforce_audit' | 'onboard_agent' | 'retire_agent' | 'agent365_mail_triage' | 'on_demand';
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
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('head-of-hr'),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createAgentCreationTools(),
    ...createAccessAuditTools(),
    ...createAgentDirectoryTools(),
    ...createEntraHRTools(),
    ...await createAgent365McpTools('head-of-hr'),
    ...await createGlyphorMcpTools('head-of-hr'),
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
    case 'agent365_mail_triage':
      initialMessage = params.message || 'Check your email inbox for new messages. Use Agent365 MailTools (mcp_MailTools) to read and process unread emails, respond to onboarding requests and agent profile questions, and escalate anything outside your scope.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Check the overall workforce health and report any agents with incomplete profiles or onboarding issues.';
      break;
    default:
      initialMessage = params.message || 'Run a quick workforce health check across all active agents.';
  }
  const agentCfg = await loadAgentConfig('head-of-hr', { temperature: 0.3, maxTurns: 15 });

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
