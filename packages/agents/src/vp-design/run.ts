/**
 * VP Design & Frontend — Runner Entry Point
 *
 * Executes the VP Design agent for design quality audits,
 * design system governance, and output quality management.
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
import { VP_DESIGN_SYSTEM_PROMPT } from './systemPrompt.js';
import { createVPDesignTools } from './tools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgentCreationTools } from '../shared/agentCreationTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createFrontendCodeTools } from '../shared/frontendCodeTools.js';
import { createScreenshotTools } from '../shared/screenshotTools.js';
import { createDesignSystemTools } from '../shared/designSystemTools.js';
import { createAuditTools } from '../shared/auditTools.js';
import { createAssetTools } from '../shared/assetTools.js';
import { createScaffoldTools } from '../shared/scaffoldTools.js';
import { createDeployPreviewTools } from '../shared/deployPreviewTools.js';
import { createFigmaTools } from '../shared/figmaTools.js';
import { createStorybookTools } from '../shared/storybookTools.js';
import { createCanvaTools } from '../shared/canvaTools.js';
import { createLogoTools } from '../shared/logoTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createWebBuildTools } from '../shared/webBuildTools.js';
import { createDesignBriefTools } from '../shared/designBriefTools.js';

export interface VPDesignRunParams {
  task?: 'design_audit' | 'design_system_review' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runVPDesign(params: VPDesignRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'vp-design', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createVPDesignTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('vp-design'),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createSharePointTools(),
    ...createAgentCreationTools(),
    ...createAgentDirectoryTools(),
    ...createFrontendCodeTools(),
    ...createScreenshotTools(),
    ...createDesignSystemTools(),
    ...createAuditTools(),
    ...createDesignBriefTools(),
    ...createAssetTools(glyphorEventBus),
    ...createScaffoldTools(),
    ...createDeployPreviewTools(),
    ...createWebBuildTools(memory, {
      allowBuild: true,
      allowIterate: true,
      allowUpgrade: true,
      allowedBuildTiers: ['prototype', 'full_build', 'iterate'],
    }),
    ...createFigmaTools(),
    ...createStorybookTools(),
    ...createCanvaTools(),
    ...createLogoTools(),
    ...await createAgent365McpTools('vp-design'),
    ...await createGlyphorMcpTools('vp-design'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[VP-Design] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'design_audit';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'design_audit':
      initialMessage = `Perform a design quality audit for ${today}.

Steps:
1. Use get_design_quality_summary to check recent quality scores and trends
2. Use get_design_tokens to review current token values
3. Use get_component_library to assess component coverage
4. Use get_template_registry to check template performance
5. Grade the current state: A+/A/B/C/F distribution
6. Identify the top "AI smell" patterns dragging quality down
7. Use write_design_audit to save your findings
8. Use log_activity to record this audit
9. If any design changes need founder approval, use create_decision`;
      break;

    case 'design_system_review':
      initialMessage = `Review the design system health for ${today}.

Steps:
1. Use get_design_tokens to audit typography, color, and spacing tokens
2. Use get_component_library for component variant coverage
3. Use get_template_registry for template usage and quality
4. Assess overall design system maturity and gaps
5. Write recommendations for improvements
6. Log your analysis`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a design quality and system status summary.';
      break;

    default:
      initialMessage = params.message || 'Provide a design quality and system status summary.';
  }
  const agentCfg = await loadAgentConfig('vp-design', { temperature: 0.4, maxTurns: 10 });

  const config: AgentConfig = {
    id: `vp-design-${task}-${today}`,
    role: 'vp-design',
    systemPrompt: VP_DESIGN_SYSTEM_PROMPT,
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
    createRunDeps(glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('vp-design', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[VP-Design] Failed to record run:', (e as Error).message);
  }

  console.log(`[VP-Design] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
