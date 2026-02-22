/**
 * Revenue Analyst (Anna Park) — Runner
 * Reports to Nadia Okafor (CFO). Revenue tracking and forecasting.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { REVENUE_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createRevenueAnalystTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createEventTools } from '../shared/eventTools.js';

export interface RevenueAnalystRunParams {
  task?: 'revenue_report' | 'forecast' | 'on_demand';
  message?: string;
}

export async function runRevenueAnalyst(params: RevenueAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!, supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [...createRevenueAnalystTools(memory), ...createMemoryTools(memory), ...createEventTools(glyphorEventBus)];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'revenue_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'revenue_report':
      initialMessage = `Generate a revenue report. Query Stripe revenue (MRR, ARR), break down by product and cohort. Calculate LTV/CAC. Check churn revenue. Flag anomalies and emit insights.`;
      break;
    case 'forecast':
      initialMessage = `Build a 90-day revenue forecast. Pull historical MRR data, analyze trends, and generate projections. Compare against pipeline data. Flag risks to forecast.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a revenue analysis.';
      break;
    default:
      initialMessage = 'Run a revenue analysis.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'revenue-analyst', { model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `anna-${task}-${today}`, role: 'revenue-analyst',
    systemPrompt: REVENUE_ANALYST_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 60_000, temperature: agentCfg.temperature,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(supabase, glyphorEventBus, memory));
  try { await memory.recordAgentRun('revenue-analyst', 0, 0.02); } catch {}
  console.log(`[Anna] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
