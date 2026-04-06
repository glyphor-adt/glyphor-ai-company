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
  task?: 'daily_analysis' | 'on_demand' | 'watch_tool_gaps' | 'memory_consolidation';
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
  const consolidationMode = task === 'memory_consolidation';
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
      initialMessage = params.message ?? [
        `Daily analysis cycle for ${today}. Execute these tool calls in order:`,
        '',
        '1. audit_channel_delivery_config() — check Teams delivery paths',
        '2. read_gtm_report() — overall GTM status',
        '3. read_fleet_health() — full fleet picture',
        '4. read_tool_failure_rates(min_failure_rate: 0.15) — broken tools',
        '5. read_blocked_assignments(need_type: "tool_access") — blocked agents',
        '6. watch_tool_gaps() — auto-resolve tool gaps',
        '7. list_tool_fix_proposals(status: "approved") and list_tool_fix_proposals(status: "pending") — execute safe code fixes and mark each one applied',
        '',
        'After each tool call, take autonomous action on what you find (grant tools, trigger reflections, write findings).',
        'For proposal fixes you complete, call mark_tool_fix_applied with concise execution notes.',
        'For anything outside your autonomous tier, use create_approval_request.',
        'End with your structured output (human summary + JSON report).',
        '',
        'IMPORTANT: Call the tools above — do not skip tool calls or produce only text.',
      ].join('\n');
      break;

    case 'watch_tool_gaps':
      initialMessage = params.message ?? 'Run watch_tool_gaps now. Focus only on unresolved fleet_findings where finding_type=\'tool_gap\'. Auto-resolve what is safe, escalate the rest, and return a concise status summary.';
      break;

    case 'memory_consolidation':
      initialMessage = params.message
        ?? 'Run memory consolidation: recall existing memories, merge duplicates, save only durable consolidated facts. Summarize changes.';
      break;

    case 'on_demand':
    default:
      initialMessage = params.message ?? 'Provide a current fleet health summary.';
      break;
  }

  const agentCfg = await loadAgentConfig('platform-intel', {
    temperature: 1.0,
    maxTurns: consolidationMode ? Math.min(22, PLATFORM_INTEL_CONFIG.maxTurns) : PLATFORM_INTEL_CONFIG.maxTurns,
  }, task);

  // Analysis-heavy tasks need higher stall tolerance — Nexus often plans between tool calls
  const analysisTask = task === 'daily_analysis' || task === 'on_demand';
  const maxStallTurns = analysisTask ? 8 : consolidationMode ? 5 : 4;

  const config: AgentConfig = {
    id: `platform-intel-${task}-${today}-${Date.now()}`,
    role: 'platform-intel',
    systemPrompt: PLATFORM_INTEL_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns,
    timeoutMs: consolidationMode ? 420_000 : 600_000,
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
