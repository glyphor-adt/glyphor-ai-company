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
import { createLogoTools } from '../shared/logoTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createWebBuildTools } from '../shared/webBuildTools.js';
import { createGithubFromTemplateTools, createGithubPushFilesTools, createGithubPullRequestTools, createVercelProjectTools } from '@glyphor/integrations';
import { createWebBuildPlannerTools } from '../shared/webBuildPlannerTools.js';
import { createQuickDemoWebAppTools } from '../shared/quickDemoAppTools.js';
import { createDesignBriefTools } from '../shared/designBriefTools.js';
import { createSandboxDevTools } from '../shared/sandboxDevTools.js';
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
  const isChat = params.task === 'on_demand' || !params.task;
  const task = params.task || 'on_demand';

  // ─── TASK-SPECIFIC TOOL SURFACES ────────────────────────────
  // Each task gets only the tools it actually uses. Cuts prompt
  // size, speeds up model responses, and reduces startup cost.
  //
  // on_demand (chat):     ~45 tools — build, preview, core essentials
  // design_audit:         ~40 tools — quality tools, audit, design system
  // design_system_review: ~30 tools — design tokens, components, templates
  // default (generic):    ~60 tools — broad but no Figma/Canva/MCP

  // Shared tool blocks used across multiple task profiles
  const coreDeps = { glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL };
  const vpDesign = createVPDesignTools(memory);
  const designSystem = createDesignSystemTools();

  let tools: ReturnType<typeof createCoreTools>;

  if (isChat) {
    tools = [
      // Build & preview — the core chat workflow
      ...createQuickDemoWebAppTools(),
      ...createWebBuildPlannerTools(),
      ...createDeployPreviewTools(),
      ...createFrontendCodeTools(),
      ...createScreenshotTools(),
      ...createWebBuildTools(memory, {
        allowBuild: true,
        allowIterate: true,
        allowAutonomousLoop: true,
        allowUpgrade: false,
        allowedBuildTiers: ['prototype', 'full_build', 'iterate'],
      }),
      // GitHub operations (create/push/promote via pull request)
      ...createGithubFromTemplateTools(),
      ...createGithubPushFilesTools(),
      ...createGithubPullRequestTools(),
      ...createVercelProjectTools(),
      // Lighthouse audits (system prompt grants this authority)
      ...createAuditTools(),
      // Minimal core (memory, messages, knowledge)
      ...createCoreTools(coreDeps, { chatOnly: true }),
      // Asset generation
      ...createAssetTools(glyphorEventBus),
      ...createLogoTools(),
      // Coordination
      ...createAgentDirectoryTools(),
    ];
  } else if (task === 'design_audit') {
    tools = [
      ...vpDesign,
      ...designSystem,
      ...createAuditTools(),
      ...createScreenshotTools(),
      ...createCoreTools(coreDeps),
      ...createTeamOrchestrationTools(glyphorEventBus),
      ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
      ...createAgentDirectoryTools(),
      ...await createAgent365McpTools('vp-design'),
      ...await createGlyphorMcpTools('vp-design'),
    ];
  } else if (task === 'design_system_review') {
    tools = [
      ...vpDesign,
      ...designSystem,
      ...createScreenshotTools(),
      ...createCoreTools(coreDeps),
      ...createFrontendCodeTools(),
      ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
      ...await createAgent365McpTools('vp-design'),
      ...await createGlyphorMcpTools('vp-design'),
    ];
  } else {
    // Generic scheduled task — broad surface with MCP
    tools = [
      ...vpDesign,
      ...createCoreTools(coreDeps),
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
      ...createWebBuildPlannerTools(),
      ...createQuickDemoWebAppTools(),
      ...createAssetTools(glyphorEventBus),
      ...createScaffoldTools(),
      ...createDeployPreviewTools(),
      ...createGithubPullRequestTools(),
      ...createVercelProjectTools(),
      ...createWebBuildTools(memory, {
        allowBuild: true,
        allowIterate: true,
        allowAutonomousLoop: true,
        allowUpgrade: true,
        allowedBuildTiers: ['prototype', 'full_build', 'iterate'],
      }),
      ...createLogoTools(),
      ...await createAgent365McpTools('vp-design'),
      ...await createGlyphorMcpTools('vp-design'),
    ];
  }

  console.log(`[VP-Design] Task=${task}: loaded ${tools.length} tools`);

  const today = new Date().toISOString().split('T')[0];
  const enableSandboxOnDemand = process.env.VP_DESIGN_ENABLE_SANDBOX_ON_DEMAND === 'true';
  if (!isChat || enableSandboxOnDemand) {
    tools.push(...createSandboxDevTools({
      repo: 'glyphor-adt/glyphor-ai-company',
      branch: 'main',
      agentRole: 'vp-design',
      runId: `mia-${task}-${today}`,
    }));
  }

  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[VP-Design] ${event.type}`, JSON.stringify(event));
  });

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
  const agentCfg = await loadAgentConfig('vp-design', { temperature: 0.4, maxTurns: 15 });

  const config: AgentConfig = {
    id: `vp-design-${task}-${today}`,
    role: 'vp-design',
    systemPrompt: VP_DESIGN_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    // Allow multi-minute invoke_web_build; companyAgentRunner uses min(config, ON_DEMAND_* timeout).
    timeoutMs: 960_000,
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
