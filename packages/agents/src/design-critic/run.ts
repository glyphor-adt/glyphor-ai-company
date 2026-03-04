/**
 * Design Critic (Sofia Marchetti) — Runner
 * Reports to Mia Tanaka (VP Design). Quality grading, anti-pattern detection.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { DESIGN_CRITIC_SYSTEM_PROMPT } from './systemPrompt.js';
import { createDesignCriticTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createEventTools } from '../shared/eventTools.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createFrontendCodeTools } from '../shared/frontendCodeTools.js';
import { createScreenshotTools } from '../shared/screenshotTools.js';
import { createDesignSystemTools } from '../shared/designSystemTools.js';
import { createAuditTools } from '../shared/auditTools.js';
import { createFigmaTools } from '../shared/figmaTools.js';
import { createStorybookTools } from '../shared/storybookTools.js';
import { createEmailTools } from '../shared/emailTools.js';
import { createSharePointTools } from '../shared/sharepointTools.js';
import { createAgent365McpTools } from '../shared/agent365Tools.js';

export interface DesignCriticRunParams {
  task?: 'grade_builds' | 'quality_report' | 'on_demand';
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runDesignCritic(params: DesignCriticRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company', gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({ geminiApiKey: process.env.GOOGLE_AI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY });
  const runner = createRunner(modelClient, 'design-critic', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();
  const tools = [
    ...createDesignCriticTools(memory),
    ...createMemoryTools(memory),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(glyphorEventBus),
    ...createFrontendCodeTools(),
    ...createScreenshotTools(),
    ...createDesignSystemTools(),
    ...createAuditTools(),
    ...createFigmaTools(),
    ...createStorybookTools(),
    ...createEmailTools(),
    ...createSharePointTools(),
    ...await createAgent365McpTools(['mcp_CalendarTools', 'mcp_TeamsServer', 'mcp_M365Copilot']),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;
  switch (task) {
    case 'grade_builds':
      initialMessage = 'Review recent Fuse builds and grade each on the quality rubric. Look for anti-patterns: centered gradient blobs, generic hero sections, flat section rhythm, and rainbow color palettes. Provide specific fix recommendations.';
      break;
    case 'quality_report':
      initialMessage = 'Generate a quality trend report. Analyze grades over the last 30 days, identify improving and declining patterns, and update the Wall of Fame / Wall of Shame.';
      break;
    case 'on_demand':
      initialMessage = params.message || 'Critique and review design quality as directed.';
      break;
    default:
      initialMessage = params.message || 'Critique and review design quality as directed.';
  }
  const agentCfg = await loadAgentConfig('design-critic', { temperature: 0.7, maxTurns: 10 });

  const config: AgentConfig = {
    id: `sofia-${task}-${today}`, role: 'design-critic',
    systemPrompt: DESIGN_CRITIC_SYSTEM_PROMPT, model: agentCfg.model,
    tools, maxTurns: agentCfg.maxTurns, maxStallTurns: 3, timeoutMs: 300_000, temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory: params.conversationHistory,
  };
  const supervisor = new AgentSupervisor({ maxTurns: config.maxTurns, maxStallTurns: config.maxStallTurns, timeoutMs: config.timeoutMs, onEvent: (event) => eventBus.emit(event) });
  const result = await runner.run(config, initialMessage, supervisor, toolExecutor, (event) => eventBus.emit(event), memory, createRunDeps(glyphorEventBus, memory));
  try { await memory.recordAgentRun('design-critic', 0, 0.08); } catch {}
  console.log(`[Sofia] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
