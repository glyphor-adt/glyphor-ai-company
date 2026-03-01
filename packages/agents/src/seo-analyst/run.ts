/**
 * SEO Analyst (Lisa Chen) — Runner
 * Reports to Maya Brooks (CMO). Search engine optimization and keyword strategy.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { SEO_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createSeoAnalystTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface SeoAnalystRunParams {
  task?: 'ranking_report' | 'keyword_research' | 'competitor_gap' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runSeoAnalyst(params: SeoAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = createRunner(modelClient, 'seo-analyst', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createSeoAnalystTools(memory),
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'ranking_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'ranking_report':
      initialMessage = `Generate an SEO ranking report. Check current keyword positions, Search Console data, and backlink changes. Highlight top movers (up and down). Flag any ranking losses > 5 positions.`;
      break;
    case 'keyword_research':
      initialMessage = `Run keyword research. Discover new keyword opportunities related to our core topics (design systems, AI design tools, developer tools). Analyze volume, difficulty, and competitor coverage.`;
      break;
    case 'competitor_gap':
      initialMessage = `Perform a competitor gap analysis. Compare our keyword rankings against top competitors. Identify keywords they rank for that we don't. Prioritize by search volume and business relevance.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run an SEO analysis.';
      break;
    default:
      initialMessage = params.message || 'Run an SEO analysis.';
  }
  const agentCfg = await loadAgentConfig('seo-analyst', { model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `lisa-${task}-${today}`, role: 'seo-analyst',
    systemPrompt: SEO_ANALYST_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('seo-analyst', 0, 0.03); } catch {}
  console.log(`[Lisa] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
