/**
 * CFO — Runner Entry Point
 *
 * Executes the CFO agent for cost monitoring, financial reports, and budget analysis.
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
import { CFO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCFOTools } from './tools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createRevenueTools } from '../shared/revenueTools.js';
import { createCostManagementTools } from '../shared/costManagementTools.js';
import { createCashFlowTools } from '../shared/cashFlowTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface CFORunParams {
  task?: 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
}

export async function runCFO(params: CFORunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'cfo', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createCFOTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('cfo'),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createAgentDirectoryTools(),
    ...createRevenueTools(),
    ...createCostManagementTools(),
    ...createCashFlowTools(),
    ...await createAgent365McpTools('cfo'),
    ...await createGlyphorMcpTools('cfo'),
  ];
  const toolExecutor = new ToolExecutor(tools, params.dryRun === true);

  eventBus.on('*', (event) => {
    console.log(`[CFO] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'daily_cost_check';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'daily_cost_check':
      initialMessage = `Perform the daily cost check for ${today}.

Steps:
1. Use get_financials for the last 7 days to see cost trends
2. Use get_product_metrics for both internal engines to see revenue
3. Use calculate_unit_economics for each product
4. Analyze: Are costs rising? Is margin healthy? Any anomalies?
5. Use write_financial_report to archive a "daily_costs" report
6. Use log_activity to record your analysis
7. If there are cost spikes (>20% day-over-day) or margin concerns, create_decision to alert Andrew
8. IMPORTANT: Update the company knowledge base "Current Metrics" section with the latest numbers:
   a. Use read_company_doctrine with section_filter "metrics" to get the section ID
   b. Use update_doctrine_section with the section ID and updated content including current MRR, paying users, build success rates, infrastructure cost MTD, gross margin, and active agent count
   c. Also update the company vitals via update_company_vitals with mrr and mrr_change_pct`;
      break;

    case 'weekly_financial_summary':
      initialMessage = `Prepare the weekly financial summary for the week ending ${today}.

Steps:
1. Use get_financials for the last 14 days (this week + prior for comparison)
2. Use get_product_metrics for both products
3. Use calculate_unit_economics for each product
4. Use get_recent_activity to see any finance-related events
5. Write a comprehensive weekly_summary report
6. Log the activity`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a financial health summary of the company.';
      break;

    default:
      initialMessage = params.message || 'Provide a financial health summary of the company.';
  }
  const agentCfg = await loadAgentConfig('cfo', { temperature: 0.3, maxTurns: 15 }, task);

  const config: AgentConfig = {
    id: `cfo-${task}-${today}`,
    role: 'cfo',
    systemPrompt: CFO_SYSTEM_PROMPT,
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
    params.evalMode ? (await import('../shared/createEvalRunDeps.js')).createEvalRunDeps(glyphorEventBus, memory) : createRunDeps(glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  if (!params.evalMode) {
    try {
      await memory.recordAgentRun('cfo', durationMs, estimatedCost);
    } catch (e) {
      console.warn('[CFO] Failed to record run:', (e as Error).message);
    }
  }

  console.log(`[CFO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
