/**
 * VP of Research & Intelligence (Sophia Lin) — Runner
 * Reports to Sarah Chen (Chief of Staff). Manages the research team.
 */
import {
  CompanyAgentRunner, ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { VP_RESEARCH_SYSTEM_PROMPT } from './systemPrompt.js';
import { createVPResearchTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';
import { createCommunicationTools } from '../shared/communicationTools.js';
import { createToolRequestTools } from '../shared/toolRequestTools.js';
import { createToolGrantTools } from '../shared/toolGrantTools.js';
import { createRunDeps, loadAgentConfig } from '../shared/createRunDeps.js';
import { createRunner } from '../shared/createRunner.js';
import { createGraphTools } from '../shared/graphTools.js';
import { createEventTools } from '../shared/eventTools.js';
import { createAssignmentTools } from '../shared/assignmentTools.js';
import { createTeamOrchestrationTools } from '../shared/teamOrchestrationTools.js';
import { createPeerCoordinationTools } from '../shared/peerCoordinationTools.js';
import { createInitiativeTools } from '../shared/initiativeTools.js';
import { createEmailTools } from '../shared/emailTools.js';

export interface VPResearchRunParams {
  task?: 'decompose_research' | 'qc_and_package_research' | 'follow_up_research' | 'on_demand';
  message?: string;
  analysisId?: string;
  /** The original query for decomposition */
  query?: string;
  /** Analysis type for decomposition */
  analysisType?: string;
  /** Depth for decomposition */
  depth?: string;
  /** Sarah's strategic context notes */
  sarahNotes?: string;
  /** Raw research packets for QC task */
  rawPackets?: Record<string, unknown>;
  /** Executive routing map for QC task */
  executiveRouting?: Record<string, string[]>;
  /** Strategic gaps for follow-up task */
  gaps?: unknown[];
  maxToolCalls?: number;
  conversationHistory?: ConversationTurn[];
}

export async function runVPResearch(params: VPResearchRunParams = {}) {
  const memory = new CompanyMemoryStore({
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });
  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = createRunner(modelClient, 'vp-research', params.task ?? 'on_demand');
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({});
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();

  const tools = [
    ...createVPResearchTools(),
    ...createMemoryTools(memory),
    ...createToolGrantTools('vp-research'),
    ...createCommunicationTools(glyphorEventBus, process.env.SCHEDULER_URL),
    ...createToolRequestTools(),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createEventTools(glyphorEventBus),
    ...createAssignmentTools(glyphorEventBus),
    ...createTeamOrchestrationTools(glyphorEventBus),
    ...createPeerCoordinationTools(glyphorEventBus),
    ...createInitiativeTools(glyphorEventBus),
    ...createEmailTools(),
  ];
  const toolExecutor = new ToolExecutor(tools);

  const task = params.task || 'on_demand';
  const today = new Date().toISOString().split('T')[0];
  const maxTurns = params.maxToolCalls ? params.maxToolCalls + 3 : 15;

  let initialMessage: string;

  if (task === 'decompose_research') {
    initialMessage = `TASK: decompose_research

Sarah has asked you to run research for a strategic analysis.

SARAH'S REQUEST:
Query: "${params.query || ''}"
Analysis Type: "${params.analysisType || 'competitive_landscape'}"
Depth: "${params.depth || 'standard'}"
Special Focus: "${params.sarahNotes || 'No special notes.'}"

YOUR TEAM:
- Lena Park (competitive-research-analyst): Competitive research — profiling, features, pricing, reviews
- Daniel Okafor (market-research-analyst): Market research — sizing, financials, funding, benchmarks
- Kai Nakamura (technical-research-analyst): Technical research — stacks, APIs, architecture, moats
- Amara Diallo (industry-research-analyst): Industry research — PESTLE, trends, regulation, adoption

Create a research brief for each analyst that should participate (based on depth).
For Standard depth: pick 2 analysts and 2 executives.
For Deep depth: use all 4 analysts and 3-4 executives.
For Comprehensive: all 4 analysts, all 4 executives, plan follow-ups.

Routing options:
- cpo (Elena Vasquez): Product strategy, Ansoff — needs competitive + technical
- cfo (Nadia Al-Rashid): Financial analysis, BCG — needs market + competitive pricing
- cmo (Maya Brooks): Positioning, Blue Ocean — needs competitive + market + industry
- cto (Marcus Reeves): Technical strategy, Porter's — needs technical + competitive

Return structured JSON with keys: briefs (array), executiveRouting (object), analystCount, execCount.`;
  } else if (task === 'qc_and_package_research') {
    const packetsJSON = JSON.stringify(params.rawPackets || {}, null, 2);
    const routingJSON = JSON.stringify(params.executiveRouting || {}, null, 2);
    initialMessage = `TASK: qc_and_package_research

Your analysts have completed their research for analysis ${params.analysisId || 'unknown'}.
Original query: "${params.query || ''}"

RESEARCH PACKETS:
${packetsJSON}

EXECUTIVE ROUTING:
${routingJSON}

Review each packet against your QC checklist. Fill gaps yourself with web searches if needed (1-5 targeted searches). Write a cover memo for each executive.

Return structured JSON with keys: qcPackets (cleaned packets), coverMemos (per-exec object), gapsFilled (array of what you researched), remainingGaps (array), overallConfidence ("high"|"medium"|"low").`;
  } else if (task === 'follow_up_research') {
    const gapsJSON = JSON.stringify(params.gaps || [], null, 2);
    initialMessage = `TASK: follow_up_research

Sarah has identified strategic gaps that need follow-up research.

GAPS TO INVESTIGATE:
${gapsJSON}

For each gap:
1. Can you fill it yourself with a few targeted searches? Do it.
2. If deeper investigation is needed, create a brief for the appropriate analyst.

Return structured JSON with keys: findings (object), analystBriefs (array of { analystRole, researchBrief, searchQueries } — or empty array if you handled it all).`;
  } else {
    initialMessage = params.message || 'Run a research status check.';
  }

  const agentCfg = await loadAgentConfig('vp-research', {
    model: 'gemini-3-flash-preview', temperature: 0.3, maxTurns,
  });

  const config: AgentConfig = {
    id: `sophia-${task}-${today}-${Date.now()}`,
    role: 'vp-research',
    systemPrompt: VP_RESEARCH_SYSTEM_PROMPT,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 600_000,  // 10 min — QC + gap-filling takes time
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

  const result = await runner.run(
    config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event), memory,
    createRunDeps(glyphorEventBus, memory),
  );
  try { await memory.recordAgentRun('vp-research', 0, 0.10); } catch {}
  console.log(`[Sophia] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
