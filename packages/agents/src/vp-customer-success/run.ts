/**
 * VP Customer Success — Runner Entry Point
 *
 * Executes the VP-CS agent for health scoring, churn detection, and customer analysis.
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
import { VP_CUSTOMER_SUCCESS_SYSTEM_PROMPT } from './systemPrompt.js';
import { createVPCSTools } from './tools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface VPCSRunParams {
  task?: 'daily_health_scoring' | 'churn_detection' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runVPCS(params: VPCSRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'vp-customer-success', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createVPCSTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('vp-customer-success'),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createSharePointTools(),
    ...createAgentCreationTools(),
    ...createAgentDirectoryTools(),
    ...await createAgent365McpTools(),
    ...await createGlyphorMcpTools('vp-customer-success'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[VP-CS] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'daily_health_scoring';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'daily_health_scoring':
      initialMessage = `Run the daily customer health scoring cycle for ${today}.

Steps:
1. Use get_product_metrics for both Fuse and Pulse
2. Use read_company_memory for "customers.segments" and "customers.health_scores"
3. Use get_financials for revenue-per-segment context
4. Score each segment: Power (>0.8), Regular (0.5-0.8), Casual (0.3-0.5), Dormant (<0.3)
5. Use write_health_report with segment counts and analysis
6. If any Power users are at risk of churn, use log_activity with action "alert"
7. Use log_activity to summarise the health scoring run`;
      break;

    case 'churn_detection':
      initialMessage = `Run churn-risk detection across customers for ${today}.

Steps:
1. Use read_company_memory for "customers.health_scores" and "customers.segments"
2. Use get_product_metrics for both products
3. Use get_recent_activity to see any recent engagement changes
4. Identify accounts with declining engagement over time
5. For high-risk churns, use create_decision for founder review
6. Use log_activity to summarise churn-risk findings`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a customer success analysis.';
      break;

    default:
      initialMessage = params.message || 'Provide a customer success analysis.';
  }
  const agentCfg = await loadAgentConfig('vp-customer-success', { temperature: 0.3, maxTurns: 10 });

  const config: AgentConfig = {
    id: `vpcs-${task}-${today}`,
    role: 'vp-customer-success',
    systemPrompt: VP_CUSTOMER_SUCCESS_SYSTEM_PROMPT,
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
    await memory.recordAgentRun('vp-customer-success', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[VP-CS] Failed to record run:', (e as Error).message);
  }

  console.log(`[VP-CS] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
