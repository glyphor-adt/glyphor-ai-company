/**
 * Social Media Manager (Kai Johnson) — Runner
 * Reports to Maya Brooks (CMO). Social media scheduling and analytics.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createSocialMediaManagerTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { effectiveMaxTurnsForReactiveTask } from '../shared/reactiveTurnBudget.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createSocialMediaTools } from '../shared/socialMediaTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface SocialMediaManagerRunParams {
  task?: 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
  dryRun?: boolean;
  evalMode?: boolean;
}

export async function runSocialMediaManager(params: SocialMediaManagerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY });
  const runner = createRunner(modelClient, 'social-media-manager', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createSocialMediaManagerTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createSharePointTools(),
    ...createSocialMediaTools(glyphorEventBus),
    ...await createAgent365McpTools('social-media-manager'),
    ...await createGlyphorMcpTools('social-media-manager'),
  ];
  const toolExecutor = new ToolExecutor(tools, params.dryRun === true);

  const task = params.task || 'engagement_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'engagement_report':
      initialMessage = `Generate a social media engagement report. Review metrics across all platforms — followers, engagement rate, impressions. Identify top performing posts. Report optimal posting times and audience demographics.`;
      break;
    case 'schedule_batch':
      initialMessage = `Review approved content drafts and schedule them. Check optimal times for each platform. Queue up the next batch of social posts.`;
      break;
    case 'mention_scan':
      initialMessage = `Scan for brand mentions and relevant conversations. Check for any mentions that need attention or response. Flag anything requiring Maya's review.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Manage social media as directed.';
      break;
    default:
      initialMessage = params.message || 'Manage social media as directed.';
  }
  const agentCfg = await loadAgentConfig('social-media-manager', { temperature: 0.3, maxTurns: 15 }, task);

  const config: AgentConfig = {
    id: `kai-${task}-${today}`, role: 'social-media-manager',
    systemPrompt: SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: effectiveMaxTurnsForReactiveTask(task, agentCfg.maxTurns), maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(
    config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory,
    params.evalMode ? (await import('../shared/createEvalRunDeps.js')).createEvalRunDeps(glyphorEventBus, memory) : createRunDeps(glyphorEventBus, memory),
  );
  if (!params.evalMode) { try { await memory.recordAgentRun('social-media-manager', 0, 0.03); } catch {} }
  console.log(`[Kai] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
