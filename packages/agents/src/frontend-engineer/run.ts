/**
 * Frontend Engineer (Ava Chen) — Runner
 * Reports to Mia Tanaka (VP Design). Tailwind components, accessibility, performance.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { FRONTEND_ENGINEER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createFrontendEngineerTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createFrontendCodeTools } from '../shared/frontendCodeTools.js';
import { createScreenshotTools } from '../shared/screenshotTools.js';
import { createAuditTools } from '../shared/auditTools.js';
import { createScaffoldTools } from '../shared/scaffoldTools.js';
import { createDeployPreviewTools } from '../shared/deployPreviewTools.js';
import { createStorybookTools } from '../shared/storybookTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';
import { createWebBuildTools } from '../shared/webBuildTools.js';
import { createBuildWebsiteFoundationTools } from '../shared/webBuildTools.js';
import { createWebBuildPlannerTools } from '../shared/webBuildPlannerTools.js';
import { createCodexTools } from '../shared/codexTools.js';
import { createDesignSystemTools } from '../shared/designSystemTools.js';
import { createQuickDemoWebAppTools } from '../shared/quickDemoAppTools.js';
import { createGithubFromTemplateTools, createGithubPushFilesTools, createGithubPullRequestTools, createVercelProjectTools, createCloudflarePreviewTools } from '@glyphor/integrations';

export interface FrontendEngineerRunParams {
  task?: 'implement_component' | 'accessibility_audit' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runFrontendEngineer(params: FrontendEngineerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'frontend-engineer', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createFrontendEngineerTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createFrontendCodeTools(),
    ...createScreenshotTools(),
    ...createAuditTools(),
    ...createScaffoldTools(),
    ...createDeployPreviewTools(),
    ...createCodexTools(),
    ...createDesignSystemTools(),
    ...createQuickDemoWebAppTools(),
    ...createGithubFromTemplateTools(),
    ...createGithubPushFilesTools(),
    ...createGithubPullRequestTools(),
    ...createVercelProjectTools(),
    ...createCloudflarePreviewTools(),
    ...createBuildWebsiteFoundationTools(),
    ...createWebBuildPlannerTools(),
    ...createWebBuildTools(memory, {
      allowBuild: true,
      allowIterate: true,
      allowAutonomousLoop: true,
      allowUpgrade: false,
      allowedBuildTiers: ['prototype', 'full_build'],
    }),
    ...createStorybookTools(),
    ...createSharePointTools(),
    ...await createAgent365McpTools('frontend-engineer'),
    ...await createGlyphorMcpTools('frontend-engineer'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'implement_component':
      initialMessage = 'Check for approved component specs and implement them as production-ready Tailwind CSS components. Ensure all components pass accessibility checks with ARIA labels and keyboard navigation.';
      break;
    case 'accessibility_audit':
      initialMessage = 'Audit existing components for accessibility compliance. Check ARIA labels, keyboard navigation, color contrast, and screen reader compatibility. Flag violations as blockers.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Assist with frontend implementation as directed.';
      break;
    default:
      initialMessage = params.message || 'Assist with frontend implementation as directed.';
  }
  const agentCfg = await loadAgentConfig('frontend-engineer', { temperature: 0.7, maxTurns: 15 });

  const config: AgentConfig = {
    id: `ava-${task}-${today}`, role: 'frontend-engineer',
    systemPrompt: FRONTEND_ENGINEER_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 960_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('frontend-engineer', 0, 0.08); } catch {}
  console.log(`[Ava] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
