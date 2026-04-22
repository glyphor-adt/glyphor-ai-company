/**
 * CLO (Victoria Chase) — Runner Entry Point
 *
 * Executes the CLO agent for legal analysis, regulatory monitoring,
 * contract review, and compliance assessments.
 * Reports directly to founders, not through Sarah Chen.
 */

import { getGoogleAiApiKey } from '@glyphor/shared';


import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CLO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { effectiveMaxTurnsForReactiveTask } from '../shared/reactiveTurnBudget.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createDocuSignTools } from '../shared/docusignTools.js';
import { createLegalDocumentTools } from '../shared/legalDocumentTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface CLORunParams {
  task?: 'regulatory_scan' | 'contract_review' | 'compliance_check' | 'agent365_mail_triage' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
  systemPromptOverride?: string;
}

export async function runCLO(params: CLORunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
  });
  const runner = createRunner(modelClient, 'clo', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createToolGrantTools('clo'),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createAgentCreationTools(),
    ...createAgentDirectoryTools(),
    ...createDocuSignTools(),
    ...createLegalDocumentTools(),
    ...await createAgent365McpTools('clo'),
    ...await createGlyphorMcpTools('clo'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[CLO] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'regulatory_scan';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'regulatory_scan':
      initialMessage = `Perform the weekly AI regulation scan for ${today}.

Steps:
1. Research current AI regulation developments (EU AI Act, US federal, state laws)
2. Check for any new enforcement actions, case law, or legislative updates
3. Assess impact on Glyphor's products and operations
4. Log findings and flag any items requiring founder attention
5. If any urgent regulatory changes detected, create a decision for the founders`;
      break;

    case 'contract_review':
      initialMessage = params.message || 'Review any pending contract requests or legal document tasks. Check for items requiring legal review from other executives.';
      break;

    case 'compliance_check':
      initialMessage = `Perform a monthly compliance check for ${today}.

Steps:
1. Review current compliance obligations and deadlines
2. Check data privacy compliance posture (GDPR, CCPA/CPRA readiness)
3. Audit open source license compliance
4. Review AI disclosure and transparency requirements
5. Update the legal risk register with any new findings
6. Brief the founders on compliance status

IMPORTANT: Only assert findings about live product features (e.g. footer links, consent flows, UI elements) if you have verified them with a tool or if your loaded context explicitly confirms their status. Do not infer absence from lack of data.`;
      break;

    case 'agent365_mail_triage':
      initialMessage = params.message || 'Check your email inbox for new messages. Use Agent365 MailTools (mcp_MailTools) to read and process unread emails, respond to legal correspondence, review contract requests, and escalate anything requiring founder attention.';
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a legal health summary covering current compliance status, pending legal items, and any regulatory developments requiring attention.';
      break;

    default:
      initialMessage = params.message || 'Provide a legal health summary covering current compliance status, pending legal items, and any regulatory developments requiring attention.';
  }
  const agentCfg = await loadAgentConfig('clo', { temperature: 0.3, maxTurns: 15 }, task);

  const config: AgentConfig = {
    id: `clo-${task}-${today}`,
    role: 'clo',
    systemPrompt: params.systemPromptOverride ?? CLO_SYSTEM_PROMPT,
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

  const startTime = Date.now();

  const result = await runner.run(
    config,
    initialMessage,
    supervisor,
    toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    createRunDeps(glyphorEventBus, memory, { systemPromptOverride: params.systemPromptOverride }),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('clo', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CLO] Failed to record run:', (e as Error).message);
  }

  console.log(`[CLO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
