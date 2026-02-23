/**
 * Competitive Intel (Daniel Ortiz) — Runner
 * Reports to Elena Vasquez (CPO). Market & competitor intelligence.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { COMPETITIVE_INTEL_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCompetitiveIntelTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createEventTools } from '../shared/eventTools.js';

export interface CompetitiveIntelRunParams {
  task?: 'landscape_scan' | 'deep_dive' | 'on_demand';
  message?: string;
}

export async function runCompetitiveIntel(params: CompetitiveIntelRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!, supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [...createCompetitiveIntelTools(memory), ...createMemoryTools(memory), ...createEventTools(glyphorEventBus)];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'landscape_scan';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'landscape_scan':
      initialMessage = `Run a competitive landscape scan. Check GitHub releases, Hacker News, and Product Hunt for competitor activity. Identify new threats, product launches, and pricing changes. Store findings and emit insights for anything 🟡 or 🔴.`;
      break;
    case 'deep_dive':
      initialMessage = `Perform a deep competitive analysis. Check tech stacks, job postings, and pricing for our top competitors. Cross-reference signals to identify strategic shifts. Write a comprehensive brief.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a competitive intelligence scan.';
      break;
    default:
      initialMessage = 'Run a competitive intelligence scan.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'competitive-intel', { model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `daniel-${task}-${today}`, role: 'competitive-intel',
    systemPrompt: COMPETITIVE_INTEL_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(supabase, glyphorEventBus, memory));
  try { await memory.recordAgentRun('competitive-intel', 0, 0.05); } catch {}
  console.log(`[Daniel] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
