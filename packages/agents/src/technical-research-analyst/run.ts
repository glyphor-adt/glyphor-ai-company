/**
 * Technical Research Analyst (Kai Nakamura) — Runner
 * Reports to Sarah Chen (Chief of Staff). Technical landscape research.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { TECHNICAL_RESEARCH_ANALYST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createTechnicalResearchAnalystTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createResearchRepoTools } from '../shared/researchRepoTools.js';
import { createResearchMonitoringTools } from '../shared/researchMonitoringTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface TechnicalResearchAnalystRunParams {
  task?: 'research' | 'on_demand';
  message?: string;
  analysisId?: string;
  researchBrief?: string;
  searchQueries?: string[];
  maxToolCalls?: number;
  conversationHistory?: ConversationTurn[];
}

export async function runTechnicalResearchAnalyst(params: TechnicalResearchAnalystRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'technical-research-analyst', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();

  const tools = [
    ...createTechnicalResearchAnalystTools(),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createResearchRepoTools(),
    ...createResearchMonitoringTools(),
    ...await createAgent365McpTools(['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']),
    ...await createGlyphorMcpTools('technical-research-analyst'),
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
    initialMessage = params.message || 'Run a technical landscape research scan.';
  }

  const agentCfg = await loadAgentConfig('technical-research-analyst', {
    temperature: 0.2, maxTurns,
  });

  const config: AgentConfig = {
    id: `kai-${task}-${today}-${Date.now()}`,
    role: 'technical-research-analyst',
    systemPrompt: TECHNICAL_RESEARCH_ANALYST_SYSTEM_PROMPT,
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
    createRunDeps(glyphorEventBus, memory),
  );
  try { await memory.recordAgentRun('technical-research-analyst', 0, 0.08); } catch {}
  console.log(`[Kai] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
