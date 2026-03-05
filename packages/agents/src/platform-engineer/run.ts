/**
 * Platform Engineer (Alex Park) — Runner Entry Point
 *
 * Reports to Marcus Reeves (CTO). Monitors platform health.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { PLATFORM_ENGINEER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createPlatformEngineerTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createEngineeringGapTools } from '../shared/engineeringGapTools.js';
import { createDiagnosticTools } from '../shared/diagnosticTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface PlatformEngineerRunParams {
  task?: 'health_check' | 'metrics_report' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runPlatformEngineer(params: PlatformEngineerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'platform-engineer', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createPlatformEngineerTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createDiagnosticTools(),
    ...createEngineeringGapTools(),
    ...await createAgent365McpTools(['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']),
    ...await createGlyphorMcpTools('platform-engineer'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[Alex] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'health_check';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'health_check':
      initialMessage = `Run a comprehensive health check across all platform services.

Steps:
1. Use run_health_check to ping all services
2. Use query_cloud_run_metrics for each service (scheduler, dashboard)
3. Use query_db_health to check database connectivity
4. If any anomalies detected, emit an insight event for Marcus
5. Log your findings as an activity

Report format: STATUS → SERVICES → ANOMALIES → TRENDS`;
      break;

    case 'metrics_report':
      initialMessage = `Generate a platform metrics report.

Steps:
1. Query Cloud Run metrics for all services (last 6 hours)
2. Check Cloud SQL health
3. Query Gemini API latency
4. Compile into a structured report
5. Log as activity`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Run a health check on all platform services.';
      break;

    default:
      initialMessage = params.message || 'Run a health check on all platform services.';
  }
  const agentCfg = await loadAgentConfig('platform-engineer', { temperature: 0.2, maxTurns: 10 });

  const config: AgentConfig = {
    id: `alex-${task}-${today}`,
    role: 'platform-engineer',
    systemPrompt: PLATFORM_ENGINEER_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 300_000,
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

  const durationMs = Date.now() - Date.parse(String(result.conversationHistory[0]?.timestamp || new Date().toISOString()));
  try { await memory.recordAgentRun('platform-engineer', durationMs, 0.02); } catch {}

  console.log(`[Alex] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
