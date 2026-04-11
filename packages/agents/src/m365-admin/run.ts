/**
 * M365 Admin (Riley Morgan) — Runner Entry Point
 * Reports to Marcus Reeves (CTO). Manages Microsoft 365 tenant, Teams, email, and calendar.
 */

import { getGoogleAiApiKey } from '@glyphor/shared';


import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { M365_ADMIN_SYSTEM_PROMPT } from './systemPrompt.js';
import { createM365AdminTools } from './tools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { effectiveMaxTurnsForReactiveTask } from '../shared/reactiveTurnBudget.js';
import { createRunner } from '../shared/createRunner.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface M365AdminRunParams {
  task?: 'channel_audit' | 'user_audit' | 'agent365_mail_triage' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runM365Admin(params: M365AdminRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
  });
  const runner = createRunner(modelClient, 'm365-admin', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createM365AdminTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createToolGrantTools('m365-admin'),
    ...createSharePointTools(),
    ...await createAgent365McpTools('m365-admin'),
    ...await createGlyphorMcpTools('m365-admin'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'channel_audit';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'channel_audit':
      initialMessage = `Run a weekly Teams channel audit. List all channels, check membership counts, and flag any channels that appear empty or may be misconfigured. Write a brief admin log of your findings.`;
      break;
    case 'user_audit':
      initialMessage = `Run a user access audit. List all M365 users, check their account status, and report any accounts that are disabled or appear unused. Write findings to admin log.`;
      break;
    case 'agent365_mail_triage':
      initialMessage = params.message || 'Check your email inbox for new messages. Use Agent365 MailTools (mcp_MailTools) to read unread messages and send replies as needed.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Review the current state of the M365 tenant and report anything that needs attention.';
      break;
    default:
      initialMessage = params.message || 'Review Teams channels and user access for any issues.';
  }
  const agentCfg = await loadAgentConfig('m365-admin', { temperature: 0.2, maxTurns: 12 }, task);

  const config: AgentConfig = {
    id: `riley-${task}-${today}`,
    role: 'm365-admin',
    systemPrompt: M365_ADMIN_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: effectiveMaxTurnsForReactiveTask(task, agentCfg.maxTurns),
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

  try { await memory.recordAgentRun('m365-admin', 0, 0.02); } catch {}
  console.log(`[Riley] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
