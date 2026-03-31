/**
 * Nexus (Platform Intelligence) — Runner Entry Point
 *
 * Monitors fleet health, diagnoses issues, acts autonomously within defined
 * bounds, and escalates everything else to founders via Teams approval cards.
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
import { PLATFORM_INTEL_SYSTEM_PROMPT } from './systemPrompt.js';
import { createPlatformIntelTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createDiagnosticTools } from '../shared/diagnosticTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { PLATFORM_INTEL_CONFIG } from './config.js';

export interface PlatformIntelRunParams {
  task?: 'daily_analysis' | 'on_demand' | 'watch_tool_gaps';
  message?: string;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
}

export async function runPlatformIntel(params: PlatformIntelRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const task = params.task ?? 'on_demand';
  const runner = createRunner(modelClient, 'platform-intel', task);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});

  const tools = [
    ...createPlatformIntelTools(),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createDiagnosticTools(),
    ...createSharePointTools(),
    ...await createAgent365McpTools('platform-intel'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[Nexus] ${event.type}`, JSON.stringify(event));
  });

  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'daily_analysis':
      initialMessage = params.message ?? `Run your daily analysis cycle for ${today}. Start by calling audit_channel_delivery_config and treat any missing, mismatched, or unusable Teams delivery path as an active fleet issue. If the audit reports missing channels or delivery risks, write fleet findings for the impacted paths before continuing. Then analyze the full fleet, take autonomous actions, send approval requests for anything outside your autonomous tier. Before finishing, call watch_tool_gaps so unresolved fleet_findings where finding_type='tool_gap' are auto-built and granted without waiting for human dispatch. Produce your structured output.`;
      break;

    case 'watch_tool_gaps':
      initialMessage = params.message ?? 'Run watch_tool_gaps now. Focus only on unresolved fleet_findings where finding_type=\'tool_gap\'. Auto-resolve what is safe, escalate the rest, and return a concise status summary.';
      break;

    case 'on_demand':
    default:
      initialMessage = params.message ?? 'Provide a current fleet health summary.';
      break;
  }

  const agentCfg = await loadAgentConfig('platform-intel', {
    temperature: 1.0,
    maxTurns: PLATFORM_INTEL_CONFIG.maxTurns,
  }, task);

  const config: AgentConfig = {
    id: `platform-intel-${task}-${today}-${Date.now()}`,
    role: 'platform-intel',
    systemPrompt: PLATFORM_INTEL_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 600_000, // 10 min — fleet analysis is thorough
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
    dryRun: params.dryRun ?? params.evalMode,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const startTime = Date.now();

  const result = await runner.run(
    config,
    initialMessage,
    supervisor,
    toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    params.evalMode
      ? (await import('../shared/createEvalRunDeps.js')).createEvalRunDeps(glyphorEventBus, memory)
      : createRunDeps(glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;

  if (!params.evalMode) {
    try {
      await memory.recordAgentRun('platform-intel', durationMs, result.cost ?? 0);
    } catch (e) {
      console.warn('[Nexus] Failed to record run:', (e as Error).message);
    }
  }

  console.log(`[Nexus] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
