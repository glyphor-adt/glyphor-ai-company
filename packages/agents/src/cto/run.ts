/**
 * CTO — Runner Entry Point
 *
 * Executes the CTO agent for platform health checks and technical analysis.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CTO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCTOTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';

export interface CTORunParams {
  task?: 'platform_health_check' | 'dependency_review' | 'on_demand';
  message?: string;
}

export async function runCTO(params: CTORunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createCTOTools(memory),
    ...createMemoryTools(memory),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(memory.getSupabaseClient(), glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[CTO] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'platform_health_check';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'platform_health_check':
      initialMessage = `Perform a platform health check for ${today}.

Steps:
1. Use get_platform_health to check service status
2. Use get_infrastructure_costs for the last 7 days to spot cost anomalies
3. Use get_recent_activity to see any recent deploys or alerts  
4. Analyze the data for any concerning trends
5. Use write_health_report to archive your findings
6. Use log_activity to record this check
7. If anything needs founder attention (cost spikes, incidents), use create_decision`;
      break;

    case 'dependency_review':
      initialMessage = `Review the platform dependencies and identify any that need updating or have security concerns.

Steps:
1. Use read_company_memory to check current stack state
2. Use get_recent_activity for any recent dependency-related events
3. Analyze and report findings
4. Log your analysis`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a technical status summary of the platform.';
      break;

    default:
      initialMessage = 'Provide a technical status summary of the platform.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'cto', { model: 'gemini-3-flash-preview', temperature: 0.3, maxTurns: 10 });

  const config: AgentConfig = {
    id: `cto-${task}-${today}`,
    role: 'cto',
    systemPrompt: CTO_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 300_000,
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
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
    createRunDeps(supabase, glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('cto', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CTO] Failed to record run:', (e as Error).message);
  }

  console.log(`[CTO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
