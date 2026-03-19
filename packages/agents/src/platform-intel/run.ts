/**
 * Nexus (Platform Intelligence) — Runner Entry Point
 *
 * Monitors fleet health, diagnoses issues, acts autonomously within defined
 * bounds, and escalates everything else to founders via Teams approval cards.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { PLATFORM_INTEL_SYSTEM_PROMPT } from './systemPrompt.js';
import { createPlatformIntelTools } from './tools.js';
import { createRunDeps } from '../shared/createRunDeps.js';
import { createRunner, resolveModel } from '../shared/createRunner.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createDiagnosticTools } from '../shared/diagnosticTools.js';
import { PLATFORM_INTEL_CONFIG } from './config.js';

export interface PlatformIntelRunParams {
  task?: 'daily_analysis' | 'on_demand';
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
  ];

  eventBus.on('*', (event) => {
    console.log(`[Nexus] ${event.type}`, JSON.stringify(event));
  });

  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'daily_analysis':
      initialMessage = params.message ?? `Run your daily analysis cycle for ${today}. Analyze the full fleet, take autonomous actions, send approval requests for anything outside your autonomous tier. Produce your structured output.`;
      break;

    case 'on_demand':
      initialMessage = params.message ?? 'Provide a current fleet health summary.';
      break;

    default:
      initialMessage = params.message ?? 'Provide a current fleet health summary.';
      break;
  }

  const defaultModel = PLATFORM_INTEL_CONFIG.model;
  const dbModel = null; // Can be overridden from DB
  const model = resolveModel('platform-intel', task, defaultModel, dbModel);

  const runId = `platform-intel-${task}-${today}-${Date.now()}`;

  const deps = await createRunDeps('platform-intel', memory, glyphorEventBus, {
    task,
    message: initialMessage,
  });

  const config: AgentConfig = {
    id: runId,
    role: 'platform-intel',
    systemPrompt: PLATFORM_INTEL_SYSTEM_PROMPT,
    model,
    tools,
    maxTurns: PLATFORM_INTEL_CONFIG.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 600_000, // 10 min — fleet analysis is thorough
    temperature: 1.0,
    conversationHistory: params.conversationHistory,
    dryRun: params.dryRun ?? params.evalMode,
  };

  return runner.run(config);
}
