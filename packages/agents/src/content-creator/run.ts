/**
 * Content Creator (Tyler Reed) — Runner
 * Reports to Maya Brooks (CMO). Content drafting and performance analysis.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CONTENT_CREATOR_SYSTEM_PROMPT } from './systemPrompt.js';
import { createContentCreatorTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';

export interface ContentCreatorRunParams {
  task?: 'blog_draft' | 'social_batch' | 'performance_review' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runContentCreator(params: ContentCreatorRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = createRunner(modelClient, 'content-creator', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createContentCreatorTools(memory),
    ...createMemoryTools(memory),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
    ...createEmailTools(),
    ...createSharePointTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'blog_draft';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'blog_draft':
      initialMessage = `Review top performing content, then draft a new blog post on a trending topic relevant to Glyphor's audience (developer tools, design systems, AI workflows). Save as draft for CMO review.`;
      break;
    case 'social_batch':
      initialMessage = `Create a batch of social media posts. Draft 3-5 posts across Twitter and LinkedIn. Focus on recent product updates, blog content, or industry insights. Save all as drafts.`;
      break;
    case 'performance_review':
      initialMessage = `Analyze content performance over the last 30 days. Identify top performing pieces, underperforming content, and trends. Recommend topics and formats for next sprint.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Create content as directed.';
      break;
    default:
      initialMessage = params.message || 'Create content as directed.';
  }
  const agentCfg = await loadAgentConfig('content-creator', { temperature: 0.7, maxTurns: 10 });

  const config: AgentConfig = {
    id: `tyler-${task}-${today}`, role: 'content-creator',
    systemPrompt: CONTENT_CREATOR_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('content-creator', 0, 0.08); } catch {}
  console.log(`[Tyler] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
