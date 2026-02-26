/**
 * Industry & Trends Research Analyst (Amara Diallo) — Runner
 * Reports to Sarah Chen (Chief of Staff). Industry trends and PESTLE research.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { INDUSTRY_RESEARCH_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createIndustryResearchAnalystTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';

export interface IndustryResearchAnalystRunParams {
  task?: 'research' | 'on_demand';
  message?: string;
  analysisId?: string;
  researchBrief?: string;
  searchQueries?: string[];
  maxToolCalls?: number;
  conversationHistory?: ConversationTurn[];
}

export async function runIndustryResearchAnalyst(params: IndustryResearchAnalystRunParams = {}) {
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
  const runner = createRunner(modelClient, 'industry-research-analyst', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const supabase = memory.getSupabaseClient();

  const tools = [
    ...createIndustryResearchAnalystTools(supabase),
    ...createMemoryTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'research';
  const today = new Date().toISOString().split('T')[0];
  const maxTurns = params.maxToolCalls ? params.maxToolCalls + 3 : 15;

  let initialMessage: string;
  if (task === 'research' && params.researchBrief) {
    const searchSuggestions = params.searchQueries
      ? `\n\nSuggested search queries (start with these, then follow leads):\n${params.searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';
    initialMessage = `Research Brief:\n${params.researchBrief}${searchSuggestions}\n\nAnalysis ID: ${params.analysisId || 'standalone'}\n\nExecute your research systematically. When done, you MUST call the submit_research_packet tool BEFORE writing any text response. Text output alone is NOT delivered — only tool submissions count.`;
  } else {
    initialMessage = params.message || 'Run an industry trends research scan.';
  }

  const agentCfg = await loadAgentConfig(supabase, 'industry-research-analyst', {
    model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns,
  });

  const config: AgentConfig = {
    id: `amara-${task}-${today}-${Date.now()}`,
    role: 'industry-research-analyst',
    systemPrompt: INDUSTRY_RESEARCH_ANALYST_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 600_000,
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const result = await runner.run(
    config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event), memory,
    createRunDeps(supabase, glyphorEventBus, memory),
  );
  try { await memory.recordAgentRun('industry-research-analyst', 0, 0.08); } catch {}
  console.log(`[Amara] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
