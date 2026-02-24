/**
 * Frontend Engineer (Ava Chen) — Runner
 * Reports to Mia Tanaka (VP Design). Tailwind components, accessibility, performance.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { FRONTEND_ENGINEER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createFrontendEngineerTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface FrontendEngineerRunParams {
  task?: 'implement_component' | 'accessibility_audit' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runFrontendEngineer(params: FrontendEngineerRunParams = {}) {
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
    ...createFrontendEngineerTools(memory),
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(memory.getSupabaseClient(), glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'implement_component':
      initialMessage = 'Check for approved component specs and implement them as production-ready Tailwind CSS components. Ensure all components pass accessibility checks with ARIA labels and keyboard navigation.';
      break;
    case 'accessibility_audit':
      initialMessage = 'Audit existing components for accessibility compliance. Check ARIA labels, keyboard navigation, color contrast, and screen reader compatibility. Flag violations as blockers.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Assist with frontend implementation as directed.';
      break;
    default:
      initialMessage = params.message || 'Assist with frontend implementation as directed.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'frontend-engineer', { model: 'gemini-3-flash-preview', temperature: 0.7, maxTurns: 10 });

  const config: AgentConfig = {
    id: `ava-${task}-${today}`, role: 'frontend-engineer',
    systemPrompt: FRONTEND_ENGINEER_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(supabase, glyphorEventBus, memory));
  try { await memory.recordAgentRun('frontend-engineer', 0, 0.08); } catch {}
  console.log(`[Ava] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
