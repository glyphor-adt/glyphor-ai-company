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
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCollectiveIntelligenceTools } from '../shared/collectiveIntelligenceTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';

export interface CMORunParams {
  task?: 'weekly_content_planning' | 'generate_content' | 'seo_analysis' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runCMO(params: CMORunParams = {}) {
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
    ...createCMOTools(memory),
    ...createMemoryTools(memory),
    ...createCollectiveIntelligenceTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(memory.getSupabaseClient(), glyphorEventBus),
  ];
  const toolExecutor = new ToolExecutor(tools);

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

    default:
      initialMessage = 'Provide a content and marketing strategy summary.';
  }

  const supabase = memory.getSupabaseClient();
  const agentCfg = await loadAgentConfig(supabase, 'cmo', { model: 'gemini-3-flash-preview', temperature: 0.6, maxTurns: 10 });

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
    createRunDeps(supabase, glyphorEventBus, memory),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.totalTurns * 0.0001;

  try {
    await memory.recordAgentRun('cmo', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CMO] Failed to record run:', (e as Error).message);
  }

  console.log(`[CMO] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);
  return result;
}
