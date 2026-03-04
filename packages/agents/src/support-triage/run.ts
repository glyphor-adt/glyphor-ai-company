/**
 * Support Triage (David Santos) — Runner
 * Reports to James Turner (VP-CS). Support ticket triage and resolution.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { SUPPORT_TRIAGE_SYSTEM_PROMPT } from './systemPrompt.js';
import { createSupportTriageTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';

export interface SupportTriageRunParams {
  task?: 'triage_queue' | 'batch_analysis' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runSupportTriage(params: SupportTriageRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'support-triage', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createSupportTriageTools(memory),
    ...createMemoryTools(memory),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
    ...createEmailTools(),
    ...createSharePointTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'triage_queue';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'triage_queue':
      initialMessage = `Triage open support tickets. Query all open tickets, classify by category and priority. Draft responses for P2/P3 tickets using knowledge base articles. Escalate any P0/P1 tickets immediately. Log a summary of actions taken.`;
      break;
    case 'batch_analysis':
      initialMessage = `Analyze support ticket patterns. Batch similar tickets by category. Identify systemic issues or recurring bugs. Emit insights for any pattern affecting 5+ users.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Triage support tickets.';
      break;
    default:
      initialMessage = params.message || 'Triage support tickets.';
  }
  const agentCfg = await loadAgentConfig('support-triage', { temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `david-${task}-${today}`, role: 'support-triage',
    systemPrompt: SUPPORT_TRIAGE_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('support-triage', 0, 0.03); } catch {}
  console.log(`[David] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
