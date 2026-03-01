/**
 * Onboarding Specialist (Emma Wright) — Runner
 * Reports to James Turner (VP-CS). New user activation and onboarding optimization.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { ONBOARDING_SPECIALIST_SYSTEM_PROMPT } from './systemPrompt.js';
import { createOnboardingSpecialistTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface OnboardingSpecialistRunParams {
  task?: 'funnel_report' | 'drop_off_analysis' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runOnboardingSpecialist(params: OnboardingSpecialistRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = createRunner(modelClient, 'onboarding-specialist', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createOnboardingSpecialistTools(memory),
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'funnel_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'funnel_report':
      initialMessage = `Generate an onboarding funnel report. Track signup → first build → activation rates. Check welcome email performance. Calculate activation by cohort. Identify the biggest drop-off points.`;
      break;
    case 'drop_off_analysis':
      initialMessage = `Analyze onboarding drop-off points. Identify where new users abandon the flow. Check template usage patterns. Recommend onboarding improvements and propose an experiment.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Analyze the onboarding experience.';
      break;
    default:
      initialMessage = params.message || 'Analyze the onboarding experience.';
  }
  const agentCfg = await loadAgentConfig('onboarding-specialist', { model: 'gemini-3-flash-preview', temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `emma-${task}-${today}`, role: 'onboarding-specialist',
    systemPrompt: ONBOARDING_SPECIALIST_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('onboarding-specialist', 0, 0.02); } catch {}
  console.log(`[Emma] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
