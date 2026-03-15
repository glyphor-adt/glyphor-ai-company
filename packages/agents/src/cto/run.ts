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
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CTO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCTOTools } from './tools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createToolRegistryTools } from '../shared/toolRegistryTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createDiagnosticTools } from '../shared/diagnosticTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { systemQuery } from '@glyphor/shared/db';
import { createFuseTools } from '../shared/fuseTools.js';

export interface CTORunParams {
  task?: 'platform_health_check' | 'dependency_review' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
}

export async function runCTO(params: CTORunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'cto', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();

  // Load executive orchestration config for CTO (canary: directive decomposition)
  let orchConfig: import('../shared/executiveOrchestrationTools.js').ExecutiveOrchestrationConfig | null = null;
  try {
    const [row] = await systemQuery(
      'SELECT executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, max_assignments_per_directive, requires_plan_verification, is_canary FROM executive_orchestration_config WHERE executive_role = $1 AND can_decompose = true',
      ['cto'],
    );
    orchConfig = row ?? null;
  } catch {
    // DB table may not exist yet — safe to skip
  }

  const tools = [
    ...createCTOTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createAgentCreationTools(),
    ...createToolGrantTools('cto'),
    ...createToolRegistryTools(),
    ...createAgentDirectoryTools(),
    ...createDiagnosticTools(),
    ...createFuseTools(memory, {
      allowBuild: true,
      allowIterate: false,
      allowUpgrade: false,
      allowedBuildTiers: ['prototype', 'full_build'],
    }),
    ...await createAgent365McpTools('cto'),
    ...await createGlyphorMcpTools('cto'),
  ];

  // Conditionally add executive orchestration tools when decomposition is enabled
  if (orchConfig?.can_decompose) {
    const { createExecutiveOrchestrationTools } = await import('../shared/executiveOrchestrationTools.js');
    tools.push(...createExecutiveOrchestrationTools('cto', orchConfig, { glyphorEventBus }));
  }

  const toolExecutor = new ToolExecutor(tools, params.dryRun === true);

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
      initialMessage = params.message || 'Provide a technical status summary of the platform.';
  }
  const agentCfg = await loadAgentConfig('cto', { temperature: 0.3, maxTurns: 10 }, task);

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
    conversationHistory: params.conversationHistory,
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
    params.evalMode ? (await import('../shared/createEvalRunDeps.js')).createEvalRunDeps(glyphorEventBus, memory) : createRunDeps(glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  if (!params.evalMode) {
    try {
      await memory.recordAgentRun('cto', durationMs, estimatedCost);
    } catch (e) {
      console.warn('[CTO] Failed to record run:', (e as Error).message);
    }
  }

  console.log(`[CTO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
