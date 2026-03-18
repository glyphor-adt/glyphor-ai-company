/**
 * Template Architect (Ryan Park) — Runner
 * Reports to Mia Tanaka (VP Design). Template structures, variant management, quality ceilings.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { TEMPLATE_ARCHITECT_SYSTEM_PROMPT } from './systemPrompt.js';
import { createTemplateArchitectTools } from './tools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createFrontendCodeTools } from '../shared/frontendCodeTools.js';
import { createDesignSystemTools } from '../shared/designSystemTools.js';
import { createAssetTools } from '../shared/assetTools.js';
import { createScaffoldTools } from '../shared/scaffoldTools.js';
import { createFigmaTools } from '../shared/figmaTools.js';
import { createStorybookTools } from '../shared/storybookTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createLogoTools } from '../shared/logoTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';
import { createCoreTools } from '../shared/coreTools.js';
import { createGlyphorMcpTools } from '../shared/glyphorMcpTools.js';

export interface TemplateArchitectRunParams {
  task?: 'variant_review' | 'template_quality_audit' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runTemplateArchitect(params: TemplateArchitectRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'template-architect', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createTemplateArchitectTools(memory),
    ...createCoreTools({ glyphorEventBus, memory, schedulerUrl: process.env.SCHEDULER_URL }),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createFrontendCodeTools(),
    ...createDesignSystemTools(),
    ...createAssetTools(glyphorEventBus),
    ...createScaffoldTools(),
    ...createFigmaTools(),
    ...createStorybookTools(),
    ...createSharePointTools(),
    ...createLogoTools(),
    ...await createAgent365McpTools('template-architect'),
    ...await createGlyphorMcpTools('template-architect'),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'variant_review':
      initialMessage = 'Review all active template variants. Check quality scores, identify underperformers (below B grade average), and propose deprecations. Test top variants against diverse content types.';
      break;
    case 'template_quality_audit':
      initialMessage = 'Audit template constraint rules. Verify max section counts, color limits, and typography locks are properly enforced. Report quality ceiling per variant.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Assist with template architecture as directed.';
      break;
    default:
      initialMessage = params.message || 'Assist with template architecture as directed.';
  }
  const agentCfg = await loadAgentConfig('template-architect', { temperature: 0.35, maxTurns: 10 });

  const config: AgentConfig = {
    id: `ryan-${task}-${today}`, role: 'template-architect',
    systemPrompt: TEMPLATE_ARCHITECT_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('template-architect', 0, 0.08); } catch {}
  console.log(`[Ryan] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
