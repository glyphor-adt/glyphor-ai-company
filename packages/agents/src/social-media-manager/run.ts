/**
 * Social Media Manager (Kai Johnson) — Runner
 * Reports to Maya Patel (CMO). Social media scheduling and analytics.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT } from './systemPrompt.js';
import { createSocialMediaManagerTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createEventTools } from '../shared/eventTools.js';

export interface SocialMediaManagerRunParams {
  task?: 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand';
  message?: string;
}

export async function runSocialMediaManager(params: SocialMediaManagerRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!, supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [...createSocialMediaManagerTools(memory), ...createMemoryTools(memory), ...createEventTools(glyphorEventBus)];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'engagement_report';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'engagement_report':
      initialMessage = `Generate a social media engagement report. Review metrics across all platforms — followers, engagement rate, impressions. Identify top performing posts. Report optimal posting times and audience demographics.`;
      break;
    case 'schedule_batch':
      initialMessage = `Review approved content drafts and schedule them via Buffer. Check optimal times for each platform. Queue up the next batch of social posts.`;
      break;
    case 'mention_scan':
      initialMessage = `Scan for brand mentions and relevant conversations. Check for any mentions that need attention or response. Flag anything requiring Maya's review.`;
      break;
    case 'on_demand':
      initialMessage = params.message || 'Manage social media as directed.';
      break;
    default:
      initialMessage = 'Manage social media as directed.';
  }

  const config: AgentConfig = {
    id: `kai-${task}-${today}`, role: 'social-media-manager',
    systemPrompt: SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT, model: 'gemini-3-flash-preview',
    tools, maxTurns: 10, maxStallTurns: 3, timeoutMs: 60_000, temperature: 0.3,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, { glyphorEventBus, agentMemoryStore: memory });
  try { await memory.recordAgentRun('social-media-manager', 0, 0.03); } catch {}
  console.log(`[Kai] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
