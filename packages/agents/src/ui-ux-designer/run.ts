/**
 * UI/UX Designer (Leo Vargas) — Runner
 * Reports to Mia Tanaka (VP Design). Component specs and design system work.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { UI_UX_DESIGNER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createUiUxDesignerTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface UiUxDesignerRunParams {
  task?: 'component_spec' | 'design_token_review' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runUiUxDesigner(params: UiUxDesignerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = createRunner(modelClient, 'ui-ux-designer', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createUiUxDesignerTools(memory),
    ...createMemoryTools(memory),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'component_spec':
      initialMessage = 'Review the current design system and create or update component specs. Ensure spacing follows the 8px grid and all tokens are named consistently.';
      break;
    case 'design_token_review':
      initialMessage = 'Audit the design token system for consistency. Check color, spacing, and typography tokens. Flag any raw values that should be tokenized.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Assist with design system work as directed.';
      break;
    default:
      initialMessage = params.message || 'Assist with design system work as directed.';
  }
  const agentCfg = await loadAgentConfig('ui-ux-designer', { model: 'gemini-3-flash-preview', temperature: 0.7, maxTurns: 10 });

  const config: AgentConfig = {
    id: `leo-${task}-${today}`, role: 'ui-ux-designer',
    systemPrompt: UI_UX_DESIGNER_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('ui-ux-designer', 0, 0.08); } catch {}
  console.log(`[Leo] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
