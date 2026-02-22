/**
 * VP Sales — Runner Entry Point
 *
 * Executes the VP Sales agent for pipeline reviews, market sizing, and sales analysis.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { VP_SALES_SYSTEM_PROMPT } from './systemPrompt.js';
import { createVPSalesTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';

export interface VPSalesRunParams {
  task?: 'pipeline_review' | 'market_sizing' | 'on_demand';
  message?: string;
}

export async function runVPSales(params: VPSalesRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [
    ...createVPSalesTools(memory),
    ...createMemoryTools(memory),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[VP-Sales] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'pipeline_review';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'pipeline_review':
      initialMessage = `Run the sales pipeline review for ${today}.

Steps:
1. Use get_product_metrics for Fuse and Pulse to see adoption and growth
2. Use get_financials for revenue data
3. Use read_company_memory for "sales.pipeline" and "customers.segments"
4. Analyse the current pipeline: leads → qualified → proposals → closed
5. Identify any stalled deals or conversion-rate issues
6. Use write_pipeline_report with summary and recommendations
7. If any large deal needs founder attention, use create_decision
8. Use log_activity summarising findings`;
      break;

    case 'market_sizing':
      initialMessage = `Perform market sizing analysis for Glyphor products for ${today}.

Steps:
1. Use get_product_metrics for both products
2. Use get_financials for revenue baseline
3. Use read_company_memory for any existing market data
4. Estimate TAM, SAM, SOM for each product based on available data
5. Use write_company_memory with updated market sizing under "sales.market_sizing"
6. Use log_activity summarising the market sizing analysis`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a sales analysis and pipeline summary.';
      break;

    default:
      initialMessage = 'Provide a sales analysis and pipeline summary.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'vp-sales', { model: 'gemini-3-flash-preview', temperature: 0.3, maxTurns: 10 });

  const config: AgentConfig = {
    id: `vps-${task}-${today}`,
    role: 'vp-sales',
    systemPrompt: VP_SALES_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 60_000,
    temperature: agentCfg.temperature,
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
    createRunDeps(supabase, glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('vp-sales', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[VP-Sales] Failed to record run:', (e as Error).message);
  }

  console.log(`[VP-Sales] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
