/**
 * Account Research (Nathan Cole) — Runner
 * Reports to Rachel Kim (VP-Sales). Prospect and account intelligence.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { ACCOUNT_RESEARCH_SYSTEM_PROMPT } from './systemPrompt.js';
import { createAccountResearchTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createResearchRepoTools } from '../shared/researchRepoTools.js';
import { createResearchMonitoringTools } from '../shared/researchMonitoringTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface AccountResearchRunParams {
  task?: 'prospect_research' | 'batch_enrich' | 'on_demand';
  message?: string;
  company?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runAccountResearch(params: AccountResearchRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'account-research', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createAccountResearchTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createResearchRepoTools(),
    ...createResearchMonitoringTools(),
    ...await createAgent365McpTools(['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']),
    ...await createGlyphorMcpTools('account-research'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'prospect_research';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'prospect_research':
      initialMessage = params.company
        ? `Research ${params.company}. Look up company info, funding data, tech stack, job postings, and key contacts. Estimate dev spend. Compile a comprehensive dossier.`
        : `Research the next prospect in the pipeline. Search company info, analyze tech stack, check for buying signals, and compile a dossier for Rachel.`;
      break;
    case 'batch_enrich':
      initialMessage = `Batch enrich prospect accounts. Review accounts missing key data (funding, tech stack, contacts). Fill gaps using web search.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Research a prospect account.';
      break;
    default:
      initialMessage = params.message || 'Research a prospect account.';
  }
  const agentCfg = await loadAgentConfig('account-research', { temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `nathan-${task}-${today}`, role: 'account-research',
    systemPrompt: ACCOUNT_RESEARCH_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('account-research', 0, 0.05); } catch {}
  console.log(`[Nathan] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
