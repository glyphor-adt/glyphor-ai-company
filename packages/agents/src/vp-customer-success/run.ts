/**
 * VP Customer Success — Runner
 *
 * Tasks: daily_health_scoring, churn_detection, on_demand
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
import { createVPCSTools } from './tools.js';
import { vpCustomerSuccessPrompt } from './systemPrompt.js';

export interface VPCSRunParams {
  task: 'daily_health_scoring' | 'churn_detection' | 'on_demand';
  context?: string;
}

export async function runVPCS(params: VPCSRunParams): Promise<void> {
  const memory = new CompanyMemoryStore();
  const model = new ModelClient({ model: 'gemini-3.0-flash-preview', temperature: 0.3 });
  const eventBus = new EventBus();
  const tools = createVPCSTools(memory);
  const toolExecutor = new ToolExecutor(tools, eventBus);

  const config: AgentConfig = {
    role: 'vp-customer-success',
    systemPrompt: vpCustomerSuccessPrompt,
    maxTurns: 12,
  };

  const supervisor: AgentSupervisor = {
    authorityTier: 'green',
    allowedActions: [
      'health_scoring',
      'nurture_email',
      'segment_update',
      'support_triage',
      'churn_detection',
      'daily_health_scoring',
    ],
  };

  const runner = new CompanyAgentRunner(config, model, toolExecutor, memory, eventBus, supervisor);

  const taskPrompts: Record<string, string> = {
    daily_health_scoring: [
      'Run the daily customer health scoring cycle.',
      '1. get_product_metrics for both fuse and pulse.',
      '2. read_company_memory for "customers.segments" and "customers.health_scores".',
      '3. Get financials for revenue-per-segment context.',
      '4. Score each segment: Power (>0.8), Regular (0.5-0.8), Casual (0.3-0.5), Dormant (<0.3).',
      '5. write_health_report with segment counts and analysis.',
      '6. If any Power users at risk of churn, log_activity with action "alert".',
      '7. log_activity summarising the health scoring run.',
    ].join('\n'),

    churn_detection: [
      'Run churn-risk detection across customers.',
      '1. read_company_memory for "customers.health_scores" and "customers.segments".',
      '2. get_product_metrics for both products.',
      '3. get_recent_activity to see any recent changes.',
      '4. Identify accounts with declining engagement over time.',
      '5. For high-risk churns, create_decision for founder review.',
      '6. log_activity summarising churn-risk findings.',
    ].join('\n'),

    on_demand: params.context ?? 'Provide a customer success analysis as requested.',
  };

  const initialPrompt = taskPrompts[params.task] ?? taskPrompts.on_demand;

  await runner.run(initialPrompt);
  await memory.recordAgentRun('vp-customer-success', params.task, 'completed');
}
