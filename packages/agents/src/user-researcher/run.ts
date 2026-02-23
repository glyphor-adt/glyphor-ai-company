/**
 * User Researcher (Priya Sharma) — Runner
 * Reports to Elena Vasquez (CPO). User behavior analysis.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { USER_RESEARCHER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createUserResearcherTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';

export interface UserResearcherRunParams {
  task?: 'cohort_analysis' | 'churn_signals' | 'on_demand';
  message?: string;
}

export async function runUserResearcher(params: UserResearcherRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!, supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createUserResearcherTools(memory),
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'cohort_analysis';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'cohort_analysis':
      initialMessage = `Run a cohort analysis. Query user analytics, build metadata, and onboarding funnel. Analyze retention by signup cohort. Identify patterns and churn signals. Report findings to Elena via activity log and emit insights.`;
      break;
    case 'churn_signals':
      initialMessage = `Analyze churn signals. Query churn data, user sessions, and build metadata. Identify common patterns among churned users. Suggest interventions.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a user behavior analysis.';
      break;
    default:
      initialMessage = 'Run a user behavior analysis.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'user-researcher', { model: 'gemini-3-flash-preview', temperature: 0.3, maxTurns: 10 });

  const config: AgentConfig = {
    id: `priya-${task}-${today}`, role: 'user-researcher',
    systemPrompt: USER_RESEARCHER_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(supabase, glyphorEventBus, memory));
  try { await memory.recordAgentRun('user-researcher', 0, 0.03); } catch {}
  console.log(`[Priya] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
