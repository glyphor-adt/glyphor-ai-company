/**
 * Cost Analyst (Omar Hassan) — Runner
 * Reports to Nadia Okafor (CFO). Infrastructure cost tracking and optimization.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { COST_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCostAnalystTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createCostManagementTools } from '../shared/costManagementTools.js';
import { createCashFlowTools } from '../shared/cashFlowTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface CostAnalystRunParams {
  task?: 'cost_report' | 'waste_scan' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runCostAnalyst(params: CostAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'cost-analyst', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createCostAnalystTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createEmailTools(),
    ...createSharePointTools(),
    ...createCostManagementTools(),
    ...createCashFlowTools(),
    ...await createAgent365McpTools(['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']),
    ...await createGlyphorMcpTools('cost-analyst'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'cost_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'cost_report':
      initialMessage = `Generate a cost report. Query GCP billing, Cloud SQL usage, and Gemini API costs. Calculate unit economics. Compare against prior period. Flag any cost spikes > 20%.`;
      break;
    case 'waste_scan':
      initialMessage = `Run a waste scan. Identify unused resources, underutilized services, and over-provisioned infrastructure. Calculate potential savings for each finding.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a cost analysis.';
      break;
    default:
      initialMessage = params.message || 'Run a cost analysis.';
  }
  const agentCfg = await loadAgentConfig('cost-analyst', { temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `omar-${task}-${today}`, role: 'cost-analyst',
    systemPrompt: COST_ANALYST_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('cost-analyst', 0, 0.02); } catch {}
  console.log(`[Omar] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
