/**
 * CPO — Runner Entry Point
 *
 * Executes the CPO agent for usage analysis, competitive intel, and product strategy.
 */

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
import { CPO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCPOTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';

export interface CPORunParams {
  task?: 'weekly_usage_analysis' | 'competitive_scan' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runCPO(params: CPORunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = createRunner(modelClient, 'cpo', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createCPOTools(memory),
    ...createMemoryTools(memory),
    ...createToolGrantTools('cpo'),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createCollectiveIntelligenceTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createAssignmentTools(glyphorEventBus),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createEmailTools(),
    ...createAgentCreationTools(),
    ...createToolRequestTools(),
    ...createAgentDirectoryTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[CPO] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'weekly_usage_analysis';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'weekly_usage_analysis':
      initialMessage = `Perform the weekly product usage analysis for the week ending ${today}.

Steps:
1. Use get_product_metrics for both Fuse and Pulse
2. Use get_financials for the last 14 days (compare this week to last)
3. Use get_recent_activity for the past 168 hours (7 days)
4. Analyze user engagement trends, feature adoption, and growth patterns
5. Identify key insights: What's growing? What's declining? What needs attention?
6. Use write_product_analysis with type "usage" to archive your report
7. Use log_activity to record this analysis
8. If you find critical product issues (engagement drops >15%), use create_decision`;
      break;

    case 'competitive_scan':
      initialMessage = `Perform a competitive landscape scan.

Analyze the competitive position of Fuse and Pulse against known competitors:
- Fuse: Lovable, Bolt, Cursor, v0, Replit Agent
- Pulse: Canva AI, Adobe Firefly, Jasper

Steps:
1. Use read_company_memory for any prior competitive analyses
2. Use get_product_metrics to understand our current position
3. Write a competitive analysis report
4. Log the activity`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a product strategy summary for both Fuse and Pulse.';
      break;

    default:
      initialMessage = params.message || 'Provide a product strategy summary for both Fuse and Pulse.';
  }
  const agentCfg = await loadAgentConfig('cpo', { model: 'gemini-3-flash-preview', temperature: 0.4, maxTurns: 10 }, task);

  const config: AgentConfig = {
    id: `cpo-${task}-${today}`,
    role: 'cpo',
    systemPrompt: CPO_SYSTEM_PROMPT,
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

  const startTime = Date.now();

  const result = await runner.run(
    config,
    initialMessage,
    supervisor,
    toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    createRunDeps(glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('cpo', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CPO] Failed to record run:', (e as Error).message);
  }

  console.log(`[CPO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
