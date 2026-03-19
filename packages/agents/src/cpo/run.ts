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
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createProductAnalyticsTools } from '../shared/productAnalyticsTools.js';
import { createCompetitiveIntelTools as createSharedCompetitiveIntelTools } from '../shared/competitiveIntelTools.js';
import { createRoadmapTools } from '../shared/roadmapTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

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
  });
  const runner = createRunner(modelClient, 'cpo', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createCPOTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('cpo'),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createAgentCreationTools(),
    ...createAgentDirectoryTools(),
    ...createProductAnalyticsTools(),
    ...createSharedCompetitiveIntelTools(),
    ...createRoadmapTools(),
    ...await createAgent365McpTools('cpo'),
    ...await createGlyphorMcpTools('cpo'),
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
1. Use get_financials for the last 14 days (compare this week to last)
2. Use get_recent_activity for the past 168 hours (7 days)
3. Analyze development progress, launch readiness, and operational patterns
4. Identify key insights: What progressed? What's blocked? What needs attention?
5. Use write_product_analysis with type "usage" to archive your report
6. Use log_activity to record this analysis
7. If you find critical issues, use create_decision

IMPORTANT: Glyphor is pre-revenue, pre-launch. The only external product is the AI Marketing Department. Do NOT reference Fuse or Pulse — those are internal engine names. If product data is unavailable, report "no product data available yet" and focus on development/operational progress.`;
      break;

    case 'competitive_scan':
      initialMessage = `Perform a competitive landscape scan.

Analyze the competitive position of the AI Marketing Department against known competitors in the AI agency/marketing automation space.

Steps:
1. Use read_company_memory for any prior competitive analyses
2. Write a competitive analysis report
3. Log the activity

IMPORTANT: Do NOT reference Fuse or Pulse — those are internal engine names, not products.`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a product strategy summary for the AI Marketing Department.';
      break;

    default:
      initialMessage = params.message || 'Provide a product strategy summary for the AI Marketing Department.';
  }
  const agentCfg = await loadAgentConfig('cpo', { temperature: 0.4, maxTurns: 10 }, task);

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
