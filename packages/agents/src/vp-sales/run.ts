/**
 * VP Sales — Runner
 *
 * Tasks: pipeline_review, market_sizing, on_demand
 */

import {
  CompanyAgentRunner,
  ModelClient,
  EventBus,
  ToolExecutor,
  type AgentConfig,
  type AgentSupervisor,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { createVPSalesTools } from './tools.js';
import { vpSalesPrompt } from './systemPrompt.js';

export interface VPSalesRunParams {
  task: 'pipeline_review' | 'market_sizing' | 'on_demand';
  context?: string;
}

export async function runVPSales(params: VPSalesRunParams): Promise<void> {
  const memory = new CompanyMemoryStore();
  const model = new ModelClient({ model: 'gemini-3.0-flash-preview', temperature: 0.3 });
  const eventBus = new EventBus();
  const tools = createVPSalesTools(memory);
  const toolExecutor = new ToolExecutor(tools, eventBus);

  const config: AgentConfig = {
    role: 'vp-sales',
    systemPrompt: vpSalesPrompt,
    maxTurns: 12,
  };

  const supervisor: AgentSupervisor = {
    authorityTier: 'green',
    allowedActions: [
      'account_research',
      'roi_calculator',
      'market_sizing',
      'kyc_research',
      'proposal_draft',
      'pipeline_review',
    ],
  };

  const runner = new CompanyAgentRunner(config, model, toolExecutor, memory, eventBus, supervisor);

  const taskPrompts: Record<string, string> = {
    pipeline_review: [
      'Run the sales pipeline review.',
      '1. get_product_metrics for fuse and pulse to see adoption and growth.',
      '2. get_financials for revenue data.',
      '3. read_company_memory for "sales.pipeline" and "customers.segments".',
      '4. Analyse the current pipeline: leads → qualified → proposals → closed.',
      '5. Identify any stalled deals or conversion-rate issues.',
      '6. write_pipeline_report with summary and recommendations.',
      '7. If any large deal needs founder attention, create_decision.',
      '8. log_activity summarising findings.',
    ].join('\n'),

    market_sizing: [
      'Perform market sizing analysis for Glyphor products.',
      '1. get_product_metrics for both products.',
      '2. get_financials for revenue baseline.',
      '3. read_company_memory for any existing market data.',
      '4. Estimate TAM, SAM, SOM for each product based on available data.',
      '5. write_company_memory with updated market sizing under "sales.market_sizing".',
      '6. log_activity summarising the market sizing analysis.',
    ].join('\n'),

    on_demand: params.context ?? 'Provide a sales analysis as requested.',
  };

  const initialPrompt = taskPrompts[params.task] ?? taskPrompts.on_demand;

  await runner.run(initialPrompt);
  await memory.recordAgentRun('vp-sales', params.task, 'completed');
}
