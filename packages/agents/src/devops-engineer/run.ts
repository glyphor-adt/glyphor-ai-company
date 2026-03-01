/**
 * DevOps Engineer (Jordan Hayes) — Runner Entry Point
 * Reports to Marcus Reeves (CTO). CI/CD and infrastructure optimization.
 */

import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { DEVOPS_ENGINEER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createDevOpsEngineerTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface DevOpsEngineerRunParams {
  task?: 'optimization_scan' | 'pipeline_report' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runDevOpsEngineer(params: DevOpsEngineerRunParams = {}) {
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
  const runner = createRunner(modelClient, 'devops-engineer', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createDevOpsEngineerTools(memory),
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'optimization_scan';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'optimization_scan':
      initialMessage = `Run an infrastructure optimization scan. Check cache metrics, resource utilization, cold starts, and identify unused resources. Calculate potential cost savings and compile a report for Marcus.`;
      break;
    case 'pipeline_report':
      initialMessage = `Generate a CI/CD pipeline performance report. Query pipeline metrics, build times, and deploy times. Identify bottlenecks and suggest improvements.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Analyze infrastructure for optimization opportunities.';
      break;
    default:
      initialMessage = params.message || 'Analyze infrastructure for optimization opportunities.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig('devops-engineer', { model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `jordan-${task}-${today}`, role: 'devops-engineer',
    systemPrompt: DEVOPS_ENGINEER_SYSTEM_PROMPT,
    model: agentCfg.model, tools, maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event),
  });

  const result = await runner.run(config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));

  try { await memory.recordAgentRun('devops-engineer', 0, 0.02); } catch {}
  console.log(`[Jordan] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
