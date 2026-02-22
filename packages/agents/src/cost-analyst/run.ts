/**
 * Cost Analyst (Omar Hassan) — Runner
 * Reports to Nadia Okafor (CFO). Infrastructure cost tracking and optimization.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { COST_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCostAnalystTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createEventTools } from '../shared/eventTools.js';

export interface CostAnalystRunParams {
  task?: 'cost_report' | 'waste_scan' | 'on_demand';
  message?: string;
}

export async function runCostAnalyst(params: CostAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!, supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [...createCostAnalystTools(memory), ...createMemoryTools(memory), ...createEventTools(glyphorEventBus)];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'cost_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'cost_report':
      initialMessage = `Generate a cost report. Query GCP billing, Supabase usage, and Gemini API costs. Calculate unit economics. Compare against prior period. Flag any cost spikes > 20%.`;
      break;
    case 'waste_scan':
      initialMessage = `Run a waste scan. Identify unused resources, underutilized services, and over-provisioned infrastructure. Calculate potential savings for each finding.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a cost analysis.';
      break;
    default:
      initialMessage = 'Run a cost analysis.';
  }

  const config: AgentConfig = {
    id: `omar-${task}-${today}`, role: 'cost-analyst',
    systemPrompt: COST_ANALYST_SYSTEM_PROMPT, model: 'gemini-3-flash-preview',
    tools, maxTurns: 10, maxStallTurns: 3, timeoutMs: 60_000, temperature: 0.2,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, { glyphorEventBus, agentMemoryStore: memory });
  try { await memory.recordAgentRun('cost-analyst', 0, 0.02); } catch {}
  console.log(`[Omar] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
