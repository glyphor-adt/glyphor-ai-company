/**
 * CMO — Runner Entry Point
 *
 * Executes the CMO agent for content planning, generation, and brand management.
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
import { CMO_SYSTEM_PROMPT } from './systemPrompt.js';
import { createCMOTools } from './tools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createAgentDirectoryTools } from '../shared/agentDirectoryTools.js';
import { createContentTools } from '../shared/contentTools.js';
import { createSeoTools } from '../shared/seoTools.js';
import { createSocialMediaTools } from '../shared/socialMediaTools.js';
import { createMarketingIntelTools } from '../shared/marketingIntelTools.js';
import { createCanvaTools } from '../shared/canvaTools.js';
import { createLogoTools } from '../shared/logoTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createFuseTools } from '../shared/fuseTools.js';
import { systemQuery } from '@glyphor/shared/db';

export interface CMORunParams {
  task?:
    | 'weekly_content_planning'
    | 'generate_content'
    | 'seo_analysis'
    | 'orchestrate'
    | 'content_planning_cycle'
    | 'work_loop'
    | 'process_assignments'
    | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
}

export async function runCMO(params: CMORunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });
  const runner = createRunner(modelClient, 'cmo', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();

  // Load executive orchestration config for CMO (directive decomposition for marketing team)
  let orchConfig: import('../shared/executiveOrchestrationTools.js').ExecutiveOrchestrationConfig | null = null;
  try {
    const [row] = await systemQuery(
      'SELECT executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, max_assignments_per_directive, requires_plan_verification, is_canary FROM executive_orchestration_config WHERE executive_role = $1 AND can_decompose = true',
      ['cmo'],
    );
    orchConfig = row ?? null;
  } catch {
    // DB table may not exist yet — safe to skip
  }

  const tools = [
    ...createCMOTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...createToolGrantTools('cmo'),
    ...createCollectiveIntelligenceTools(memory),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createAgentDirectoryTools(),
    ...createContentTools(),
    ...createSeoTools(),
    ...createSocialMediaTools(glyphorEventBus),
    ...createMarketingIntelTools(),
    ...createFuseTools(memory, {
      allowBuild: true,
      allowIterate: false,
      allowUpgrade: false,
      allowedBuildTiers: ['prototype'],
    }),
    ...createCanvaTools(),
    ...createLogoTools(),
    ...await createAgent365McpTools('cmo'),
    ...await createGlyphorMcpTools('cmo'),
  ];

  // Conditionally add executive orchestration tools when decomposition is enabled
  if (orchConfig?.can_decompose) {
    const { createExecutiveOrchestrationTools } = await import('../shared/executiveOrchestrationTools.js');
    tools.push(...createExecutiveOrchestrationTools('cmo', orchConfig, { glyphorEventBus }));
  }

  const toolExecutor = new ToolExecutor(tools, params.dryRun === true);

  eventBus.on('*', (event) => {
    console.log(`[CMO] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'weekly_content_planning';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'weekly_content_planning':
      initialMessage = `Plan this week's content calendar starting ${today}.

Steps:
1. Use read_company_memory to check the current content calendar and brand guidelines
2. Use get_product_metrics for both Fuse and Pulse to find data-driven angles
3. Use get_recent_activity for the past week to find newsworthy events
4. Plan 3-5 content pieces for the week:
   - At least 1 blog post concept (technical or case study)
   - 2-3 social posts (Twitter/X and LinkedIn)
   - 1 SEO-focused piece if gaps exist
5. Use write_content with type "content_calendar" to save the plan
6. Use write_company_memory to update the "content.calendar.current" key
7. Use log_activity to record the planning session`;
      break;

    case 'generate_content':
      initialMessage = params.message || `Generate a blog post about Glyphor's AI-first approach.

Steps:
1. Use read_company_memory for brand voice guidelines
2. Use get_product_metrics for real data points to include
3. Write the blog post following brand guidelines
4. Save it using write_content
5. Log the activity`;
      break;

    case 'seo_analysis':
      initialMessage = `Perform an SEO gap analysis for Glyphor.

Steps:
1. Use read_company_memory for any prior SEO analyses
2. Use get_product_metrics to understand our product positioning
3. Analyze target keywords: AI app builder, autonomous AI, AI design tool
4. Write an SEO report with recommendations
5. Save using write_content with type "seo_report"
6. Log the activity`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a content and marketing strategy summary.';
      break;

    case 'orchestrate':
      initialMessage = params.message || `Orchestrate marketing work for ${today}.

Steps:
1. Use read_founder_directives to check for any delegated marketing directives
2. Use check_team_status to see what your team has in flight
3. For new directives: decompose into assignments for your team (content-creator, seo-analyst, social-media-manager, marketing-intelligence-analyst)
4. For completed work: evaluate_team_output and accept or request revision
5. Synthesize completed deliverables back to Sarah`;
      break;

    case 'content_planning_cycle':
      initialMessage = params.message || `Run content planning cycle for ${today}.

Steps:
1. Review current content calendar and recent performance
2. Identify gaps in content coverage and SEO
3. Decompose needed content into team assignments:
   - Blog posts and articles → content-creator
   - SEO optimization work → seo-analyst
   - Social media posts → social-media-manager
   - Market intelligence needs → marketing-intelligence-analyst
4. Track progress on existing assignments
5. Report status to Sarah`;
      break;

    case 'work_loop':
      initialMessage =
        params.message ||
        `Scheduled work loop for ${today}. Review marketing directives delegated to you, check_team_status for your team's assignments, and orchestrate (decompose / evaluate / synthesize) as needed.`;
      break;

    case 'process_assignments':
      initialMessage =
        params.message ||
        `Assignment sweep for ${today}. Process pending marketing work: read_founder_directives, check_team_status, dispatch or evaluate outputs, use synthesize_team_deliverable when ready, escalate blockers to Sarah.`;
      break;

    default:
      initialMessage = params.message || 'Provide a content and marketing strategy summary.';
  }
  const agentCfg = await loadAgentConfig('cmo', { temperature: 0.6, maxTurns: 10 }, task);

  const config: AgentConfig = {
    id: `cmo-${task}-${today}`,
    role: 'cmo',
    systemPrompt: CMO_SYSTEM_PROMPT,
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
      await memory.recordAgentRun('cmo', durationMs, estimatedCost);
    } catch (e) {
      console.warn('[CMO] Failed to record run:', (e as Error).message);
    }
  }

  console.log(`[CMO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
