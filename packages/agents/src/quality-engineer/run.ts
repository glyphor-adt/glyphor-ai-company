/**
 * Quality Engineer (Sam DeLuca) — Runner Entry Point
 * Reports to Marcus Reeves (CTO). QA and testing.
 */

import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { QUALITY_ENGINEER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createQualityEngineerTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createEngineeringGapTools } from '../shared/engineeringGapTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface QualityEngineerRunParams {
  task?: 'qa_report' | 'regression_check' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runQualityEngineer(params: QualityEngineerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'quality-engineer', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createQualityEngineerTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createEngineeringGapTools(),
    ...await createAgent365McpTools('quality-engineer'),
    ...await createGlyphorMcpTools('quality-engineer'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'qa_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'qa_report':
      initialMessage = `Run a QA analysis. Query build logs, check for error patterns, classify any issues found, and produce a QA report. File bug reports for any P0 or P1 issues.`;
      break;
    case 'regression_check':
      initialMessage = `Check for regressions. Query recent build outcomes, compare error patterns over the last 7 days, and flag any new failure patterns.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Run a QA analysis on recent builds.';
      break;
    default:
      initialMessage = params.message || 'Run a QA analysis on recent builds.';
  }
  const agentCfg = await loadAgentConfig('quality-engineer', { temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `sam-${task}-${today}`, role: 'quality-engineer',
    systemPrompt: QUALITY_ENGINEER_SYSTEM_PROMPT,
    model: agentCfg.model, tools, maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event),
  });

  const result = await runner.run(config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));

  try { await memory.recordAgentRun('quality-engineer', 0, 0.03); } catch {}
  console.log(`[Sam] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
