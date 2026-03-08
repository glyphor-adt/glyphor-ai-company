/**
 * Scheduler HTTP Server — Cloud Run entry point
 *
 * Listens for:
 * - POST /pubsub — Pub/Sub push messages (from Cloud Scheduler)
 * - POST /run    — Direct task invocation
 * - GET  /health — Health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { GlyphorEventBus, ModelClient, promptCache, getRedisCache, WorkflowOrchestrator } from '@glyphor/agent-runtime';
import type { CompanyAgentRole, AgentExecutionResult, GlyphorEvent, ConversationTurn, ConversationAttachment, WorkflowStatus } from '@glyphor/agent-runtime';
import { handleStripeWebhook, syncStripeAll, syncBillingToDB, syncMercuryAll, syncOpenAIBilling, syncAnthropicBilling, syncKlingBilling, syncSharePointKnowledge, type KlingCredentials, TeamsBotHandler, extractBearerToken, runGovernanceSync, GraphChatHandler, ChatSubscriptionManager, GraphTeamsClient, getM365Token, loadConversationRefs, A365TeamsChatClient } from '@glyphor/integrations';
import { SYSTEM_PROMPTS } from '@glyphor/agents';
import { systemQuery } from '@glyphor/shared/db';
import { EventRouter } from './eventRouter.js';
import { DecisionQueue } from './decisionQueue.js';
import { DynamicScheduler } from './dynamicScheduler.js';
import { AnalysisEngine } from './analysisEngine.js';
import sharp from 'sharp';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AnalysisType, AnalysisDepth } from './analysisEngine.js';
import { SimulationEngine } from './simulationEngine.js';
import { MeetingEngine } from './meetingEngine.js';
import { CotEngine } from './cotEngine.js';
import { DeepDiveEngine } from './deepDiveEngine.js';
import { StrategyLabEngine, type StrategyAnalysisType } from './strategyLabEngine.js';
import {
  exportAnalysisMarkdown, exportAnalysisJSON,
  exportAnalysisPPTX, exportAnalysisDOCX,
  exportSimulationMarkdown, exportSimulationJSON,
  exportSimulationPPTX, exportSimulationDOCX,
  exportCotMarkdown, exportCotJSON,
  exportDeepDiveMarkdown, exportDeepDiveJSON,
  exportDeepDiveDOCX, exportDeepDivePPTX,
  buildVisualPrompt,
  exportStrategyLabPPTX, exportStrategyLabDOCX,
  buildStrategyLabVisualPrompt,
} from './reportExporter.js';
import { WakeRouter } from './wakeRouter.js';
import { DataSyncScheduler } from './dataSyncScheduler.js';
import { HeartbeatManager } from './heartbeat.js';
import { AgentNotifier } from './agentNotifier.js';
import { handleDashboardApi } from './dashboardApi.js';
import { verifyPlan } from './planVerifier.js';
import { consolidateMemory } from './memoryConsolidator.js';
import { archiveExpiredMemory } from './memoryArchiver.js';
import { evaluateBatch } from './batchOutcomeEvaluator.js';
import { collectProposals } from './policyProposalCollector.js';
import { evaluateDraftPolicies } from './policyReplayEvaluator.js';
import { manageCanaries } from './policyCanaryManager.js';
import { expireTools } from './toolExpirationManager.js';
import { evaluateCanary } from './canaryEvaluator.js';
import { handleTriangulatedChat } from './triangulationEndpoint.js';
import {
  runChiefOfStaff, runCTO, runCFO, runCLO, runCPO, runCMO, runVPCS, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runRevenueAnalyst, runCostAnalyst,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runOnboardingSpecialist, runSupportTriage,
  runAccountResearch,
  runUiUxDesigner, runFrontendEngineer, runDesignCritic, runTemplateArchitect,
  runM365Admin,
  runGlobalAdmin,
  runHeadOfHR,
  runOps,
  runCompetitiveResearchAnalyst,
  runMarketResearchAnalyst,
  runTechnicalResearchAnalyst,
  runIndustryResearchAnalyst,
  runVPResearch,
  runDynamicAgent,
} from '@glyphor/agents';

const PORT = parseInt(process.env.PORT || '8080', 10);

// ─── Logo watermark ─────────────────────────────────────────────
const LOGO_PATH = path.resolve(import.meta.dirname, '../../dashboard/public/glyphor-logo.png');
const LOGO_FALLBACK = path.resolve(import.meta.dirname, '../../../public/glyphor-logo.png');
let logoBuf: Buffer | null = null;
try {
  logoBuf = fs.readFileSync(fs.existsSync(LOGO_PATH) ? LOGO_PATH : LOGO_FALLBACK);
} catch { /* logo not available — skip watermark */ }

async function applyWatermark(imageB64: string): Promise<string> {
  if (!logoBuf) return imageB64;
  const imgBuf = Buffer.from(imageB64, 'base64');
  const meta = await sharp(imgBuf).metadata();
  const imgW = meta.width ?? 1536;
  const imgH = meta.height ?? 1024;
  // Scale logo to ~4% of image width, place bottom-right corner with padding
  const logoW = Math.round(imgW * 0.04);
  const resizedLogo = await sharp(logoBuf)
    .resize({ width: logoW, fit: 'inside' })
    .ensureAlpha(0.45)
    .toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const logoH = logoMeta.height ?? logoW;
  const padX = Math.round(imgW * 0.015);
  const padY = Math.round(imgH * 0.015);
  const result = await sharp(imgBuf)
    .composite([{
      input: resizedLogo,
      left: imgW - logoW - padX,
      top: imgH - logoH - padY,
    }])
    .png()
    .toBuffer();
  return result.toString('base64');
}

// ─── Bootstrap ──────────────────────────────────────────────────

const memory = new CompanyMemoryStore({
  gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
  gcpProjectId: process.env.GCP_PROJECT_ID,
});

const decisionQueue = new DecisionQueue(memory, {});

const agentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  const message = (payload.message as string) || undefined;
  let conversationHistory = payload.conversationHistory as ConversationTurn[] | undefined;

  // Thread multimodal attachments: inject as a carrier turn at the end of
  // conversationHistory so they reach CompanyAgentRunner without modifying
  // every individual runner's parameter interface.
  const rawAttach = payload.attachments as ConversationAttachment[] | undefined;
  if (rawAttach?.length) {
    if (!conversationHistory) conversationHistory = [];
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: '__multimodal_attachments__', timestamp: Date.now(), attachments: rawAttach },
    ];
  }

  // ─── Universal work_loop / proactive routing ──────────────
  // These tasks are dispatched by the heartbeat work loop for any agent.
  // Ensure the message is set from the payload so each runner's default
  // case picks it up. Keep 'work_loop' as the task so the config ID
  // contains it and the runner applies task-tier limits (6 turns / 120s)
  // instead of on_demand limits (3 / 45s).
  if ((task === 'work_loop' || task === 'proactive') && !message) {
    const effectiveMessage = (payload.wake_reason as string) ?? `Work loop: ${task}`;
    return agentExecutor(agentRole, task, { ...payload, message: effectiveMessage });
  }

  if (agentRole === 'chief-of-staff') {
    const taskMap: Record<string, 'generate_briefing' | 'check_escalations' | 'weekly_review' | 'monthly_retrospective' | 'orchestrate' | 'on_demand'> = {
      morning_briefing: 'generate_briefing',
      check_escalations: 'check_escalations',
      eod_summary: 'generate_briefing',
      weekly_review: 'weekly_review',
      monthly_retrospective: 'monthly_retrospective',
      orchestrate: 'orchestrate',
    };
    return runChiefOfStaff({
      task: taskMap[task] ?? 'on_demand',
      recipient: payload.founder as 'kristina' | 'andrew' | undefined,
      message,
      conversationHistory,
    });
  } else if (agentRole === 'cto') {
    return runCTO({ task: (task as 'platform_health_check' | 'dependency_review' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cfo') {
    return runCFO({ task: (task as 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'clo') {
    return runCLO({ task: (task as 'regulatory_scan' | 'contract_review' | 'compliance_check' | 'read_inbox' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cpo') {
    return runCPO({ task: (task as 'weekly_usage_analysis' | 'competitive_scan' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cmo') {
    return runCMO({ task: (task as 'weekly_content_planning' | 'generate_content' | 'seo_analysis' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'vp-customer-success') {
    return runVPCS({ task: (task as 'daily_health_scoring' | 'churn_detection' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'vp-sales') {
    return runVPSales({ task: (task as 'pipeline_review' | 'market_sizing' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'vp-design') {
    return runVPDesign({ task: (task as 'design_audit' | 'design_system_review' | 'on_demand'), message, conversationHistory });
  }
  // ─── Sub-team agents ────────────────────────────────────────
  // Engineering
  else if (agentRole === 'platform-engineer') {
    return runPlatformEngineer({ task: (task as 'health_check' | 'metrics_report' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'quality-engineer') {
    return runQualityEngineer({ task: (task as 'qa_report' | 'regression_check' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'devops-engineer') {
    return runDevOpsEngineer({ task: (task as 'optimization_scan' | 'pipeline_report' | 'on_demand'), message, conversationHistory });
  }
  // Product
  else if (agentRole === 'user-researcher') {
    return runUserResearcher({ task: (task as 'cohort_analysis' | 'churn_signals' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'competitive-intel') {
    return runCompetitiveIntel({ task: (task as 'landscape_scan' | 'deep_dive' | 'on_demand'), message, conversationHistory });
  }
  // Finance
  else if (agentRole === 'revenue-analyst') {
    return runRevenueAnalyst({ task: (task as 'revenue_report' | 'forecast' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cost-analyst') {
    return runCostAnalyst({ task: (task as 'cost_report' | 'waste_scan' | 'on_demand'), message, conversationHistory });
  }
  // Marketing
  else if (agentRole === 'content-creator') {
    return runContentCreator({ task: (task as 'blog_draft' | 'social_batch' | 'performance_review' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'seo-analyst') {
    return runSeoAnalyst({ task: (task as 'ranking_report' | 'keyword_research' | 'competitor_gap' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'social-media-manager') {
    return runSocialMediaManager({ task: (task as 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand'), message, conversationHistory });
  }
  // Customer Success
  else if (agentRole === 'onboarding-specialist') {
    return runOnboardingSpecialist({ task: (task as 'funnel_report' | 'drop_off_analysis' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'support-triage') {
    return runSupportTriage({ task: (task as 'triage_queue' | 'batch_analysis' | 'on_demand'), message, conversationHistory });
  }
  // Sales
  else if (agentRole === 'account-research') {
    return runAccountResearch({ task: (task as 'prospect_research' | 'batch_enrich' | 'on_demand'), message, company: payload.company as string | undefined, conversationHistory });
  }
  // Design sub-team
  else if (agentRole === 'ui-ux-designer') {
    return runUiUxDesigner({ task: (task as 'component_spec' | 'design_token_review' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'frontend-engineer') {
    return runFrontendEngineer({ task: (task as 'implement_component' | 'accessibility_audit' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'design-critic') {
    return runDesignCritic({ task: (task as 'grade_builds' | 'quality_report' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'template-architect') {
    return runTemplateArchitect({ task: (task as 'variant_review' | 'template_quality_audit' | 'on_demand'), message, conversationHistory });
  }
  // IT / M365
  else if (agentRole === 'm365-admin') {
    return runM365Admin({ task: (task as 'channel_audit' | 'user_audit' | 'on_demand'), message, conversationHistory });
  }
  // Global Admin
  else if (agentRole === 'global-admin') {
    return runGlobalAdmin({ task: (task as 'access_audit' | 'compliance_report' | 'onboarding' | 'read_inbox' | 'on_demand'), message, conversationHistory });
  }
  // People & Culture
  else if (agentRole === 'head-of-hr') {
    return runHeadOfHR({ task: (task as 'workforce_audit' | 'onboard_agent' | 'retire_agent' | 'read_inbox' | 'on_demand'), message, conversationHistory });
  }
  // Operations
  else if (agentRole === 'ops') {
    return runOps({ task: (task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'contradiction_detection' | 'knowledge_hygiene'), message, eventPayload: payload, conversationHistory });
  }
  // Strategy Lab v2 — Research Analysts
  else if (agentRole === 'vp-research') {
    return runVPResearch({ task: (task as 'decompose_research' | 'qc_and_package_research' | 'follow_up_research' | 'on_demand'), message, analysisId: payload.analysisId as string | undefined, query: payload.query as string | undefined, analysisType: payload.analysisType as string | undefined, depth: payload.depth as string | undefined, sarahNotes: payload.sarahNotes as string | undefined, rawPackets: payload.rawPackets as Record<string, unknown> | undefined, executiveRouting: payload.executiveRouting as Record<string, string[]> | undefined, gaps: payload.gaps as unknown[] | undefined, conversationHistory });
  } else if (agentRole === 'competitive-research-analyst') {
    return runCompetitiveResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else if (agentRole === 'market-research-analyst') {
    return runMarketResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else if (agentRole === 'technical-research-analyst') {
    return runTechnicalResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else if (agentRole === 'industry-research-analyst') {
    return runIndustryResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else {
    // Dynamic agent — look up in DB and run with generic runner
    console.log(`[Scheduler] Agent ${agentRole} not in static roster, trying dynamic runner...`);
    return runDynamicAgent({ role: agentRole, task, message, conversationHistory });
  }
};

// Wrap executor to record every run in agent_runs for the Activity dashboard
const trackedAgentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  const inputMsg = typeof payload?.message === 'string' ? payload.message : null;
  const startMs = Date.now();

  // Insert a "running" row in parallel with agent execution to avoid blocking
  const runIdPromise = systemQuery<{ id: string }>(
    'INSERT INTO agent_runs (agent_id, task, status, input, tenant_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [agentRole, task, 'running', inputMsg, '00000000-0000-0000-0000-000000000000'],
  ).then(([row]) => row?.id as string | undefined)
  .catch(() => undefined);

  try {
    const result = await agentExecutor(agentRole, task, payload);
    const runId = await runIdPromise;
    const durationMs = Date.now() - startMs;

    // Count tool calls from conversation history
    const toolCalls = result?.conversationHistory
      ? result.conversationHistory.filter(t => t.role === 'tool_call').length
      : null;

    if (runId) {
      const runStatus = result?.status === 'completed' ? 'completed' : (result?.status === 'error' ? 'failed' : (result?.status ?? 'completed'));
      const reasoningMeta = (result as any)?.reasoningMeta;
      await systemQuery(
        `UPDATE agent_runs SET status=$1, completed_at=$2, duration_ms=$3, turns=$4, tool_calls=$5, input_tokens=$6, output_tokens=$7, cost=$8, output=$9, error=$10, thinking_tokens=$11, cached_input_tokens=$12${reasoningMeta ? ', reasoning_passes=$13, reasoning_confidence=$14, reasoning_revised=$15, reasoning_cost_usd=$16' : ''} WHERE id=$${reasoningMeta ? 17 : 13}`,
        [
          runStatus, new Date().toISOString(), durationMs, result?.totalTurns ?? null, toolCalls, result?.inputTokens ?? null, result?.outputTokens ?? null, result?.cost ?? null, result?.output ?? null, result?.error ?? result?.abortReason ?? null, result?.thinkingTokens ?? null, result?.cachedInputTokens ?? null,
          ...(reasoningMeta ? [reasoningMeta.passes, reasoningMeta.confidence, reasoningMeta.revised, reasoningMeta.costUsd] : []),
          runId,
        ],
      );
    }

    // Process notification intents from agent output (fire-and-forget)
    if (result?.output && agentNotifier) {
      agentNotifier.processAgentOutput(agentRole, result.output)
        .then(n => { if (n > 0) console.log(`[AgentNotifier] ${agentRole} sent ${n} notification(s)`); })
        .catch(err => console.error(`[AgentNotifier] Error processing ${agentRole}:`, err));
    }

    return result;
  } catch (err) {
    const runId = await runIdPromise;
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);

    if (runId) {
      await systemQuery(
        'UPDATE agent_runs SET status=$1, completed_at=$2, duration_ms=$3, error=$4 WHERE id=$5',
        ['failed', new Date().toISOString(), durationMs, message, runId],
      );
    }

    throw err;
  }
};

const router = new EventRouter(trackedAgentExecutor, decisionQueue);
const wakeRouter = new WakeRouter(trackedAgentExecutor);
const heartbeatManager = new HeartbeatManager(trackedAgentExecutor, wakeRouter);

const strategyModelClient = new ModelClient({
  geminiApiKey: process.env.GOOGLE_AI_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
});
const analysisEngine = new AnalysisEngine(strategyModelClient);
const simulationEngine = new SimulationEngine(strategyModelClient);
const meetingEngine = new MeetingEngine(trackedAgentExecutor);
const cotEngine = new CotEngine(strategyModelClient);
const deepDiveEngine = new DeepDiveEngine(strategyModelClient);
const strategyLabEngine = new StrategyLabEngine(strategyModelClient, trackedAgentExecutor);

// Teams Bot — initialized from env vars (BOT_APP_ID, BOT_APP_SECRET, BOT_TENANT_ID)
const teamsBot = TeamsBotHandler.fromEnv(
  async (agentRole, task, payload) => {
    const result = await trackedAgentExecutor(agentRole as CompanyAgentRole, task, payload);
    return result ?? undefined;
  },
);

// Agent Notifier — delivers proactive DMs/cards when agents emit <notify> blocks
const agentNotifier = teamsBot ? new AgentNotifier(teamsBot) : null;

// Wire the bot handler into the decision queue for Teams channel notifications
decisionQueue.setBotHandler(teamsBot);

// ─── Graph Chat Handler (1:1 DMs to agent Entra accounts) ──────

const GRAPH_CHAT_WEBHOOK_PATH = '/api/graph/chat-webhook';
let graphChatClient: GraphTeamsClient | null = null;
try { graphChatClient = GraphTeamsClient.fromEnv(); } catch { /* Graph not configured */ }

const graphChatHandler = graphChatClient
  ? new GraphChatHandler(graphChatClient, async (agentRole, task, payload) => {
      const result = await trackedAgentExecutor(agentRole as CompanyAgentRole, task, payload);
      return result ?? undefined;
    })
  : null;

const chatSubscriptionManager = graphChatClient
  ? new ChatSubscriptionManager(
      graphChatClient,
      `${process.env.PUBLIC_URL ?? process.env.SERVICE_URL ?? ''}${GRAPH_CHAT_WEBHOOK_PATH}`,
    )
  : null;

// Initialize Graph chat subscriptions (async, non-blocking)
if (graphChatHandler && chatSubscriptionManager) {
  if (teamsBot) graphChatHandler.setTeamsBot(teamsBot);

  // Wire Agent 365 Teams MCP client for chat replies (delegated permissions)
  const a365TeamsClient = A365TeamsChatClient.fromEnv();
  if (a365TeamsClient) graphChatHandler.setA365TeamsClient(a365TeamsClient);

  (async () => {
    try {
      const refCount = await loadConversationRefs();
      console.log(`[ConversationStore] Loaded ${refCount} conversation references from DB`);
      await graphChatHandler.resolveAgentUserIds();
      const sub = await chatSubscriptionManager.subscribe();
      if (sub) chatSubscriptionManager.startAutoRenewal();
      else console.warn('[GraphChat] Initial subscription failed — will retry on next renewal cycle');
    } catch (err) {
      console.error('[GraphChat] Startup error:', (err as Error).message);
    }
  })();
}

// ─── Glyphor Event Bus ──────────────────────────────────────────

const glyphorEventBus = new GlyphorEventBus({});
router.setGlyphorEventBus(glyphorEventBus);

// ─── Rate Limiter (10 events per agent per hour) ────────────────

const eventRateMap = new Map<string, number[]>();
const EVENT_RATE_LIMIT = 10;
const EVENT_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkEventRate(source: string): boolean {
  const now = Date.now();
  const timestamps = eventRateMap.get(source) ?? [];
  const recent = timestamps.filter((t) => now - t < EVENT_RATE_WINDOW_MS);
  if (recent.length >= EVENT_RATE_LIMIT) return false;
  recent.push(now);
  eventRateMap.set(source, recent);
  return true;
}

// ─── HTTP Helpers ───────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

// ─── Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const rawUrl = req.url ?? '/';
  const [url, queryString] = rawUrl.split('?');
  const params = new URLSearchParams(queryString ?? '');
  const method = req.method ?? 'GET';

  try {
    // Health check
    if (url === '/health' || url === '/') {
      const cache = getRedisCache();
      const [redisPing, redisStats] = await Promise.allSettled([
        cache.ping(),
        cache.stats(),
      ]);
      json(res, 200, {
        status: 'ok',
        service: 'glyphor-scheduler',
        redis: {
          connected: redisPing.status === 'fulfilled' ? redisPing.value : false,
          ...(redisStats.status === 'fulfilled' ? redisStats.value : {}),
        },
        graphChat: chatSubscriptionManager?.getStatus() ?? { active: false, reason: 'not configured' },
      });
      return;
    }

    // Cache invalidation
    if (method === 'POST' && url === '/cache/invalidate') {
      const body = await readBody(req).catch(() => '{}');
      const { prefix } = JSON.parse(body || '{}');
      promptCache.invalidate(prefix);
      // Also invalidate Redis cache
      const cache = getRedisCache();
      if (prefix) {
        await cache.invalidatePattern(`${prefix}*`).catch(() => {});
      }
      json(res, 200, { invalidated: true, prefix: prefix ?? 'all' });
      return;
    }

    // Stripe webhook endpoint
    if (method === 'POST' && url === '/webhook/stripe') {
      const rawBody = await readBody(req);
      const result = await handleStripeWebhook(req, rawBody);

      // Reactive wake: notify relevant agents of Stripe events
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed?.type) {
          await wakeRouter.processEvent({
            type: parsed.type,
            data: parsed?.data?.object ?? {},
            source: 'stripe',
          });
        }
      } catch { /* wake is best-effort */ }

      json(res, result.status, result.body);
      return;
    }

    // Stripe data sync endpoint (called by Cloud Scheduler)
    if (method === 'POST' && url === '/sync/stripe') {
      try {
        const result = await syncStripeAll();
        await systemQuery(
          'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, updated_at=$4 WHERE id=$5',
          [new Date().toISOString(), 0, 'ok', new Date().toISOString(), 'stripe'],
        );
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['stripe']);
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await systemQuery(
          'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
          [new Date().toISOString(), message, failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'stripe'],
        );
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // GCP billing sync endpoint
    if (method === 'POST' && url === '/sync/gcp-billing') {
      try {
        const projectId = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
        const billingDataset = process.env.GCP_BILLING_DATASET || 'billing_export';
        const billingTable = process.env.GCP_BILLING_TABLE || 'gcp_billing_export_v1_012B03_F562EC_184CD8';
        const result = await syncBillingToDB(
          projectId, billingDataset, billingTable,
        );
        await systemQuery(
          'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, updated_at=$4 WHERE id=$5',
          [new Date().toISOString(), 0, 'ok', new Date().toISOString(), 'gcp-billing'],
        );
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['gcp-billing']);
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await systemQuery(
          'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
          [new Date().toISOString(), message, failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'gcp-billing'],
        );
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Mercury banking sync endpoint
    if (method === 'POST' && url === '/sync/mercury') {
      try {
        const result = await syncMercuryAll();
        await systemQuery(
          'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, updated_at=$4 WHERE id=$5',
          [new Date().toISOString(), 0, 'ok', new Date().toISOString(), 'mercury'],
        );
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['mercury']);
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await systemQuery(
          'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
          [new Date().toISOString(), message, failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'mercury'],
        );
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // OpenAI billing sync endpoint — syncs per-product keys
    if (method === 'POST' && url === '/sync/openai-billing') {
      try {
        const productKeys: Array<{ product: string; key: string }> = [];
        // Per-product keys: OPENAI_ADMIN_KEY_FUSE, OPENAI_ADMIN_KEY_PULSE, OPENAI_ADMIN_KEY_COMPANY
        if (process.env.OPENAI_ADMIN_KEY_FUSE) productKeys.push({ product: 'fuse', key: process.env.OPENAI_ADMIN_KEY_FUSE });
        if (process.env.OPENAI_ADMIN_KEY_PULSE) productKeys.push({ product: 'pulse', key: process.env.OPENAI_ADMIN_KEY_PULSE });
        if (process.env.OPENAI_ADMIN_KEY_COMPANY) productKeys.push({ product: 'glyphor-ai-company', key: process.env.OPENAI_ADMIN_KEY_COMPANY });
        // Fallback: single key defaults to 'pulse'
        if (productKeys.length === 0 && process.env.OPENAI_ADMIN_KEY) {
          productKeys.push({ product: 'pulse', key: process.env.OPENAI_ADMIN_KEY });
        }
        if (productKeys.length === 0) throw new Error('No OPENAI_ADMIN_KEY_* configured');

        const results: Record<string, { synced: number; models: number } | { error: string }> = {};
        const errors: string[] = [];
        // Deduplicate: if multiple products share the same key, call API once and reuse results
        const keyToProducts = new Map<string, string[]>();
        for (const { product, key } of productKeys) {
          const existing = keyToProducts.get(key);
          if (existing) existing.push(product);
          else keyToProducts.set(key, [product]);
        }
        for (const [key, products] of keyToProducts) {
          try {
            const result = await syncOpenAIBilling(key, products[0]);
            for (const product of products) results[product] = result;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            for (const product of products) {
              results[product] = { error: msg };
              errors.push(`${product}: ${msg}`);
            }
          }
        }
        const anySuccess = Object.values(results).some((r) => !('error' in r));
        if (anySuccess) {
          await systemQuery(
            'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, last_error=$4, updated_at=$5 WHERE id=$6',
            [new Date().toISOString(), 0, errors.length > 0 ? 'partial' : 'ok', errors.length > 0 ? errors.join('; ') : null, new Date().toISOString(), 'openai-billing'],
          );
        } else {
          const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['openai-billing']);
          const failures = (current?.consecutive_failures ?? 0) + 1;
          await systemQuery(
            'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
            [new Date().toISOString(), errors.join('; '), failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'openai-billing'],
          );
        }
        json(res, anySuccess ? 200 : 500, { success: anySuccess, products: results, errors: errors.length > 0 ? errors : undefined });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Anthropic billing sync endpoint — syncs per-product keys
    if (method === 'POST' && url === '/sync/anthropic-billing') {
      try {
        const productKeys: Array<{ product: string; key: string }> = [];
        // Per-product keys: ANTHROPIC_ADMIN_KEY_FUSE, ANTHROPIC_ADMIN_KEY_PULSE, ANTHROPIC_ADMIN_KEY_COMPANY
        if (process.env.ANTHROPIC_ADMIN_KEY_FUSE) productKeys.push({ product: 'fuse', key: process.env.ANTHROPIC_ADMIN_KEY_FUSE });
        if (process.env.ANTHROPIC_ADMIN_KEY_PULSE) productKeys.push({ product: 'pulse', key: process.env.ANTHROPIC_ADMIN_KEY_PULSE });
        if (process.env.ANTHROPIC_ADMIN_KEY_COMPANY) productKeys.push({ product: 'glyphor-ai-company', key: process.env.ANTHROPIC_ADMIN_KEY_COMPANY });
        // Fallback: single key defaults to 'glyphor-ai-company'
        if (productKeys.length === 0) {
          const fallback = process.env.ANTHROPIC_ADMIN_KEY ?? process.env.ANTHROPIC_API_KEY;
          if (fallback) productKeys.push({ product: 'glyphor-ai-company', key: fallback });
        }
        if (productKeys.length === 0) throw new Error('No ANTHROPIC_ADMIN_KEY_FUSE / ANTHROPIC_ADMIN_KEY_PULSE / ANTHROPIC_ADMIN_KEY configured');

        const results: Record<string, { synced: number; models: number } | { error: string }> = {};
        const errors: string[] = [];
        // Deduplicate: if multiple products share the same key, call API once and reuse results
        const keyToProducts = new Map<string, string[]>();
        for (const { product, key } of productKeys) {
          const existing = keyToProducts.get(key);
          if (existing) existing.push(product);
          else keyToProducts.set(key, [product]);
        }
        for (const [key, products] of keyToProducts) {
          try {
            const result = await syncAnthropicBilling(key, products[0]);
            for (const product of products) results[product] = result;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            for (const product of products) {
              results[product] = { error: msg };
              errors.push(`${product}: ${msg}`);
            }
          }
        }
        const anySuccess = Object.values(results).some((r) => !('error' in r));
        if (anySuccess) {
          await systemQuery(
            'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, last_error=$4, updated_at=$5 WHERE id=$6',
            [new Date().toISOString(), 0, errors.length > 0 ? 'partial' : 'ok', errors.length > 0 ? errors.join('; ') : null, new Date().toISOString(), 'anthropic-billing'],
          );
        } else {
          const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['anthropic-billing']);
          const failures = (current?.consecutive_failures ?? 0) + 1;
          await systemQuery(
            'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
            [new Date().toISOString(), errors.join('; '), failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'anthropic-billing'],
          );
        }
        json(res, anySuccess ? 200 : 500, { success: anySuccess, products: results, errors: errors.length > 0 ? errors : undefined });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Kling billing sync endpoint
    if (method === 'POST' && url === '/sync/kling-billing') {
      try {
        const accessKey = process.env.KLING_ACCESS_KEY;
        const secretKey = process.env.KLING_SECRET_KEY;
        if (!accessKey || !secretKey) throw new Error('KLING_ACCESS_KEY and KLING_SECRET_KEY not configured');
        const credentials: KlingCredentials = { accessKey, secretKey };
        const result = await syncKlingBilling(credentials, 'pulse');
        await systemQuery(
          'UPDATE data_sync_status SET last_success_at=$1, consecutive_failures=$2, status=$3, updated_at=$4 WHERE id=$5',
          [new Date().toISOString(), 0, 'ok', new Date().toISOString(), 'kling-billing'],
        );
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['kling-billing']);
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await systemQuery(
          'UPDATE data_sync_status SET last_failure_at=$1, last_error=$2, consecutive_failures=$3, status=$4, updated_at=$5 WHERE id=$6',
          [new Date().toISOString(), message, failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString(), 'kling-billing'],
        );
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // SharePoint knowledge sync endpoint
    if (method === 'POST' && url === '/sync/sharepoint-knowledge') {
      try {
        const result = await syncSharePointKnowledge();
        await systemQuery(
          'INSERT INTO data_sync_status (id, last_success_at, consecutive_failures, status, last_error, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET last_success_at=EXCLUDED.last_success_at, consecutive_failures=EXCLUDED.consecutive_failures, status=EXCLUDED.status, last_error=EXCLUDED.last_error, updated_at=EXCLUDED.updated_at',
          ['sharepoint-knowledge', new Date().toISOString(), 0, 'ok', null, new Date().toISOString()],
        );
        // Update sharepoint_sites with sync result
        const siteId = process.env.SHAREPOINT_SITE_ID;
        if (siteId) {
          await systemQuery(
            'UPDATE sharepoint_sites SET last_full_sync_at=$1, last_sync_result=$2, total_documents=$3, total_synced=$4, updated_at=$5 WHERE site_id=$6',
            [new Date().toISOString(), JSON.stringify(result), result.scanned, result.updated + result.skipped, new Date().toISOString(), siteId],
          );
        }
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [current] = await systemQuery<{ consecutive_failures: number }>('SELECT consecutive_failures FROM data_sync_status WHERE id=$1', ['sharepoint-knowledge']);
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await systemQuery(
          'INSERT INTO data_sync_status (id, last_failure_at, last_error, consecutive_failures, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET last_failure_at=EXCLUDED.last_failure_at, last_error=EXCLUDED.last_error, consecutive_failures=EXCLUDED.consecutive_failures, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at',
          ['sharepoint-knowledge', new Date().toISOString(), message, failures, failures >= 3 ? 'failing' : 'stale', new Date().toISOString()],
        );
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Governance IAM audit endpoint
    if (method === 'POST' && url === '/sync/governance') {
      try {
        const result = await runGovernanceSync();
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Canva OAuth callback — exchanges authorisation code for tokens
    if (method === 'GET' && url === '/oauth/canva/callback') {
      const code = params.get('code');
      if (!code) {
        json(res, 400, { error: 'Missing code parameter' });
        return;
      }
      try {
        const clientId = process.env.CANVA_CLIENT_ID;
        const clientSecret = process.env.CANVA_CLIENT_SECRET;
        if (!clientId || !clientSecret) throw new Error('CANVA_CLIENT_ID/SECRET not configured');

        const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${process.env.SCHEDULER_URL || 'https://glyphor-scheduler-v55622rp6q-uc.a.run.app'}/oauth/canva/callback`,
          }),
        });
        if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
        const tokens = await tokenRes.json() as { refresh_token: string; expires_in: number };
        // In production the refresh token should be persisted to Secret Manager.
        console.log('[Canva OAuth] Token exchange succeeded. Refresh token received.');
        json(res, 200, {
          success: true,
          message: 'Canva OAuth authorised. Store the refresh token in CANVA_REFRESH_TOKEN secret.',
          expiresIn: tokens.expires_in,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Canva OAuth] Token exchange failed:', message);
        json(res, 500, { error: `Canva OAuth failed: ${message}` });
      }
      return;
    }

    // Pub/Sub push endpoint — ack immediately, execute async to prevent redelivery
    if (method === 'POST' && url === '/pubsub') {
      const body = JSON.parse(await readBody(req));
      // Pub/Sub wraps the message in { message: { data: base64 } }
      const messageData = Buffer.from(body.message.data, 'base64').toString('utf-8');
      console.log(`[Scheduler] Pub/Sub message: ${messageData}`);

      // Respond 200 immediately so Pub/Sub doesn't redeliver while agent runs
      json(res, 200, { accepted: true });

      // Execute agent task async (fire-and-forget)
      router.handleSchedulerMessage(messageData).catch((err) => {
        console.error(`[Scheduler] Pub/Sub async execution failed:`, (err as Error).message);
      });
      return;
    }

    // Glyphor Event Bus push endpoint (from glyphor-events Pub/Sub topic)
    if (method === 'POST' && url === '/event') {
      const body = JSON.parse(await readBody(req));
      const messageData = Buffer.from(body.message.data, 'base64').toString('utf-8');
      const event: GlyphorEvent = JSON.parse(messageData);

      console.log(`[Scheduler] Event: ${event.type} from ${event.source} (${event.priority})`);

      // Rate limit per source
      if (!checkEventRate(event.source)) {
        console.warn(`[Scheduler] Rate limit exceeded for ${event.source}`);
        json(res, 429, { error: 'Rate limit exceeded', source: event.source });
        return;
      }

      // Look up last run times for smart wake decisions
      const agentLastRuns = new Map<CompanyAgentRole, Date | null>();
      try {
        const agents = await systemQuery<{ role: string; last_run_at: string | null }>(
          'SELECT role, last_run_at FROM company_agents', [],
        );
        for (const agent of agents ?? []) {
          agentLastRuns.set(
            agent.role as CompanyAgentRole,
            agent.last_run_at ? new Date(agent.last_run_at) : null,
          );
        }
      } catch (e) {
        console.warn('[Scheduler] Failed to fetch agent last runs:', (e as Error).message);
      }

      const results = await router.handleGlyphorEvent(event, agentLastRuns);

      // Reactive wake: also route through wake rules
      wakeRouter.processEvent({
        type: event.type,
        data: event.payload,
        source: event.source,
      }).catch(() => { /* best-effort */ });

      json(res, 200, { event: event.type, results });
      return;
    }

    // Heartbeat endpoint — lightweight agent check-ins (Cloud Scheduler: */10 * * * *)
    if (method === 'POST' && url === '/heartbeat') {
      const result = await heartbeatManager.runHeartbeat();
      json(res, 200, result);
      return;
    }

    // Memory consolidation endpoint — daily raw→distilled promotion (Cloud Scheduler: 0 3 * * *)
    if (method === 'POST' && url === '/memory/consolidate') {
      try {
        const report = await consolidateMemory();
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[MemoryConsolidator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Batch outcome evaluator endpoint — twice-daily quality scoring (Cloud Scheduler: 0 2,14 * * *)
    if (method === 'POST' && url === '/batch-eval/run') {
      try {
        const result = await evaluateBatch();
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[BatchOutcomeEvaluator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Memory archival endpoint — weekly TTL-based archival (Cloud Scheduler: 0 4 * * 0)
    if (method === 'POST' && url === '/memory/archive') {
      try {
        const report = await archiveExpiredMemory();
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[MemoryArchiver] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Policy proposal collection endpoint — twice-daily collection (Cloud Scheduler: 0 3,15 * * *)
    if (method === 'POST' && url === '/policy/collect') {
      try {
        const report = await collectProposals();
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PolicyProposalCollector] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Policy replay evaluation endpoint — daily offline eval of draft policies (Cloud Scheduler: 0 5 * * *)
    if (method === 'POST' && url === '/policy/evaluate') {
      try {
        const report = await evaluateDraftPolicies();
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PolicyReplayEvaluator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Policy canary check endpoint — every 4 hours canary lifecycle (Cloud Scheduler: 0 */4 * * *)
    if (method === 'POST' && url === '/policy/canary-check') {
      try {
        const report = await manageCanaries(glyphorEventBus);
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PolicyCanaryManager] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Canary evaluation endpoint — weekly executive orchestration rollout check (Cloud Scheduler: 0 8 * * 1)
    if (method === 'POST' && url === '/canary/evaluate') {
      try {
        const report = await evaluateCanary(glyphorEventBus);
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[CanaryEvaluator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Tool expiration endpoint — daily expiration of stale/unreliable dynamic tools (Cloud Scheduler: 0 6 * * *)
    if (method === 'POST' && url === '/tools/expire') {
      try {
        const report = await expireTools(glyphorEventBus);
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ToolExpirationManager] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Tool re-enable endpoint — manually restore an expired tool
    if (method === 'POST' && url === '/tools/re-enable') {
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          req.on('error', reject);
        });
        const { tool_name } = JSON.parse(body);
        if (!tool_name) { json(res, 400, { error: 'tool_name required' }); return; }
        await systemQuery(
          `UPDATE tool_reputation SET is_active = true, expired_at = NULL, expiration_reason = NULL, updated_at = NOW() WHERE tool_name = $1`,
          [tool_name],
        );
        await systemQuery(
          `UPDATE tool_registry SET is_active = true, updated_at = NOW() WHERE name = $1`,
          [tool_name],
        );
        json(res, 200, { success: true, tool_name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Teams Bot endpoint (Bot Framework messages)
    if (method === 'POST' && url === '/api/teams/messages') {
      if (!teamsBot) {
        json(res, 503, { error: 'Teams Bot not configured. Set BOT_APP_ID, BOT_APP_SECRET, BOT_TENANT_ID.' });
        return;
      }

      // Validate JWT from Bot Framework
      const token = extractBearerToken(req);
      if (!token) {
        json(res, 401, { error: 'Missing authorization token' });
        return;
      }

      const isValid = await teamsBot.validateToken(token);
      if (!isValid) {
        json(res, 403, { error: 'Invalid or expired token' });
        return;
      }

      const activity = JSON.parse(await readBody(req));
      // Respond 200 immediately, process async
      json(res, 200, { status: 'accepted' });
      teamsBot.handleActivity(activity).catch((err) => {
        console.error('[TeamsBot] Error handling activity:', (err as Error).message);
      });

      // Note: WakeRouter event removed — handleActivity already routes messages
      // to the correct agent and executes them. Firing a separate wake event
      // caused duplicate execution and name resolution bugs (display names
      // like "Rachel Kim" instead of role slugs like "vp-sales").

      return;
    }

    // Graph Chat webhook — receives change notifications for /chats/getAllMessages
    if (url === GRAPH_CHAT_WEBHOOK_PATH) {
      // Graph sends GET with validationToken query param during subscription creation
      if (method === 'GET' || method === 'POST') {
        const validationToken = params.get('validationToken');
        if (validationToken) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(validationToken);
          return;
        }
      }

      if (method === 'POST') {
        if (!graphChatHandler) {
          json(res, 503, { error: 'Graph Chat not configured' });
          return;
        }

        const body = JSON.parse(await readBody(req));
        // Respond 202 immediately — Graph requires fast response
        json(res, 202, { status: 'accepted' });
        graphChatHandler.handleNotifications(body).catch((err) => {
          console.error('[GraphChat] Error handling notifications:', (err as Error).message);
        });
        return;
      }
    }

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole ?? body.agent;

      // Build conversational message — pass clean message + proper multi-turn history
      let message = body.message as string | undefined;
      const rawHistory = body.history as { role: string; content: string }[] | undefined;

      // Inject user identity so agents know who they're talking to
      const userName = body.userName as string | undefined;
      const userEmail = body.userEmail as string | undefined;
      if (message && userEmail) {
        const FOUNDERS: Record<string, string> = { 'kristina@glyphor.ai': 'Kristina', 'andrew@glyphor.ai': 'Andrew' };
        const founderName = FOUNDERS[userEmail.toLowerCase()];
        const identity = founderName
          ? `[You are speaking with ${founderName} (${userEmail}), Co-Founder of Glyphor. Treat this as a direct conversation with your founder.]`
          : `[You are speaking with ${userName ?? 'a user'} (${userEmail}).]`;
        message = `${identity}\n${message}`;
      }

      // Accept file attachments for multimodal input (images, PDFs, documents)
      const rawAttachments = body.attachments as { name: string; mimeType: string; data: string }[] | undefined;
      const attachments = rawAttachments?.length
        ? rawAttachments.map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }))
        : undefined;

      // Convert dashboard chat history to proper ConversationTurn[] for multi-turn
      const conversationHistory: ConversationTurn[] = [];
      if (rawHistory?.length) {
        for (const h of rawHistory) {
          // Skip the last user message — it's the current message
          conversationHistory.push({
            role: h.role === 'user' ? 'user' : 'assistant',
            content: h.content,
            timestamp: Date.now(),
          });
        }
      }

      const result = await router.route({
        source: 'manual',
        agentRole,
        task: body.task,
        payload: {
          ...(body.payload ?? {}),
          message,
          ...(attachments ? { attachments } : {}),
          ...(conversationHistory.length > 0 ? { conversationHistory } : {}),
        },
      });

      // Record agent output back to work_assignments if this run was dispatched by orchestration
      const assignmentId = body.payload?.directiveAssignmentId as string | undefined;
      if (assignmentId && result.action === 'executed') {
        await systemQuery(
          'UPDATE work_assignments SET agent_output=$1, status=$2, completed_at=$3 WHERE id=$4',
          [result.output ?? result.error ?? 'No output captured', result.error ? 'failed' : 'completed', new Date().toISOString(), assignmentId],
        );
      }

      json(res, 200, result);
      return;
    }

    // ─── Agent Management Endpoints ─────────────────────────────

    // Create new agent
    if (method === 'POST' && url === '/agents/create') {
      const body = JSON.parse(await readBody(req));
      const {
        name, title, department, reports_to,
        model, temperature, max_turns,
        budget_per_run, budget_daily, budget_monthly,
        cron_expression, system_prompt, skills,
        tools: agentTools, is_temporary, ttl_days,
      } = body;

      const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent((name || 'Agent').trim())}&radius=50&bold=true`;

      let agent;
      try {
        [agent] = await systemQuery(
          `INSERT INTO company_agents (role, codename, name, display_name, title, department, reports_to, status, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_temporary, expires_at, is_core, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
          [agentId, name, name, name, title ?? '', department ?? '', reports_to ?? null, 'active', model || 'gpt-5-mini-2025-08-07', temperature ?? 0.3, max_turns ?? 10, budget_per_run ?? 0.05, budget_daily ?? 0.50, budget_monthly ?? 15, is_temporary || false, is_temporary && ttl_days ? new Date(Date.now() + ttl_days * 86400000).toISOString() : null, false, new Date().toISOString(), new Date().toISOString()],
        );
      } catch (createErr) {
        json(res, 400, { success: false, error: (createErr as Error).message });
        return;
      }

      // Store dynamic brief
      try {
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt=EXCLUDED.system_prompt, skills=EXCLUDED.skills, tools=EXCLUDED.tools, updated_at=EXCLUDED.updated_at`,
          [agentId, system_prompt ?? '', skills ?? [], agentTools ?? [], new Date().toISOString()],
        );
      } catch (briefErr) {
        console.error(`[server] Failed to store brief for ${agentId}:`, (briefErr as Error).message);
      }

      // Create agent profile with personality — avatar set separately to avoid overwriting
      try {
        await systemQuery(
          `INSERT INTO agent_profiles (agent_id, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, working_style, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (agent_id) DO UPDATE SET personality_summary=EXCLUDED.personality_summary, backstory=EXCLUDED.backstory, communication_traits=EXCLUDED.communication_traits, quirks=EXCLUDED.quirks, tone_formality=EXCLUDED.tone_formality, emoji_usage=EXCLUDED.emoji_usage, verbosity=EXCLUDED.verbosity, working_style=EXCLUDED.working_style, updated_at=EXCLUDED.updated_at`,
          [agentId, `${name} is a focused ${title || 'specialist'} in ${department || 'the company'} who prioritizes clear recommendations, practical execution steps, and concise communication.`, `Provisioned as a ${title || 'specialist'} to support ${department || 'the team'} with targeted expertise on high-priority initiatives.`, ['clear', 'structured', 'action-oriented'], ['summarizes key decisions before details'], 0.6, 0.1, 0.45, 'outcome-driven', new Date().toISOString()],
        );
      } catch (profileErr) {
        console.error(`[server] Failed to store profile for ${agentId}:`, (profileErr as Error).message);
      }

      // Set DiceBear avatar only for new profiles (don't overwrite existing PNG avatars)
      await systemQuery('UPDATE agent_profiles SET avatar_url=$1 WHERE agent_id=$2 AND avatar_url IS NULL', [avatarUrl, agentId]);

      // Store schedule if provided
      if (cron_expression) {
        await systemQuery('INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled) VALUES ($1,$2,$3,$4)', [agentId, cron_expression, 'scheduled_run', true]);
      }

      // Log creation
      await systemQuery('INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)', ['system', 'system', 'agent.created', `New agent created: ${name} (${agentId})`, new Date().toISOString()]);

      // Emit agent.spawned event to wake HR for onboarding
      try {
        await glyphorEventBus.emit({
          type: 'agent.spawned',
          source: 'system',
          payload: {
            agentRole: agentId,
            name,
            title: title ?? '',
            department: department ?? '',
            reportsTo: reports_to ?? null,
            isTemporary: is_temporary || false,
            createdBy: 'dashboard',
          },
          priority: 'normal',
        });
      } catch (e) {
        console.error(`[server] Failed to emit agent.spawned:`, e);
      }

      json(res, 200, { success: true, agent });
      return;
    }

    // Update agent settings
    const settingsMatch = url.match(/^\/agents\/([^/]+)\/settings$/);
    if (method === 'PUT' && settingsMatch) {
      const agentId = decodeURIComponent(settingsMatch[1]);
      const updates = JSON.parse(await readBody(req));

      const { system_prompt, ...agentUpdates } = updates;

      let data;
      try {
        const updates = { ...agentUpdates, updated_at: new Date().toISOString() };
        const keys = Object.keys(updates);
        const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        const values = keys.map(k => (updates as Record<string, unknown>)[k]);
        values.push(agentId);
        [data] = await systemQuery(`UPDATE company_agents SET ${setClause} WHERE id=$${keys.length + 1} RETURNING *`, values);
      } catch (updateErr) {
        json(res, 400, { success: false, error: (updateErr as Error).message });
        return;
      }

      if (system_prompt !== undefined) {
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, updated_at) VALUES ($1,$2,$3)
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt=EXCLUDED.system_prompt, updated_at=EXCLUDED.updated_at`,
          [agentId, system_prompt, new Date().toISOString()],
        );
      }

      await systemQuery('INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)', ['system', 'system', 'agent.settings_updated', `Settings updated for ${agentId}: ${Object.keys(updates).join(', ')}`, new Date().toISOString()]);

      // Invalidate cached config for this agent
      const cache = getRedisCache();
      await cache.invalidatePattern(`reasoning:config:*`).catch(() => {});
      await cache.invalidatePattern(`agent:context:*`).catch(() => {});

      json(res, 200, { success: true, agent: data });
      return;
    }

    // Upload / update agent avatar
    const avatarMatch = url.match(/^\/agents\/([^/]+)\/avatar$/);
    if (method === 'POST' && avatarMatch) {
      const agentId = decodeURIComponent(avatarMatch[1]);
      const body = JSON.parse(await readBody(req));
      const { image } = body as { image?: string };

      if (!image || typeof image !== 'string') {
        json(res, 400, { success: false, error: 'Missing "image" field (base64 data-URI)' });
        return;
      }

      // Parse data URI: data:image/png;base64,... or data:image/jpeg;base64,...
      const dataUriMatch = image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!dataUriMatch) {
        json(res, 400, { success: false, error: 'Invalid image format. Expected data:image/(png|jpeg|webp);base64,...' });
        return;
      }

      const ext = dataUriMatch[1] === 'jpeg' ? 'jpg' : dataUriMatch[1];
      const buffer = Buffer.from(dataUriMatch[2], 'base64');

      // Reject files > 2 MB
      if (buffer.length > 2 * 1024 * 1024) {
        json(res, 400, { success: false, error: 'Image too large (max 2 MB)' });
        return;
      }

      // Look up the agent role for the filename
      const [agentRow] = await systemQuery('SELECT role FROM company_agents WHERE id=$1', [agentId]);
      if (!agentRow) {
        json(res, 404, { success: false, error: 'Agent not found' });
        return;
      }

      const contentType = `image/${dataUriMatch[1]}`;
      const gcsPath = `avatars/${agentRow.role}.${ext}`;

      try {
        const { Storage } = await import('@google-cloud/storage');
        const storage = new Storage({ projectId: 'ai-glyphor-company' });
        const bucketName = (process.env.GCS_BUCKET || 'glyphor-company').trim();
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(gcsPath);
        await file.save(buffer, { contentType, resumable: false });
        await file.makePublic().catch(() => {});
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsPath}`;

        // Upsert the profile (INSERT if no row exists yet)
        await systemQuery(
          `INSERT INTO agent_profiles (agent_id, avatar_url, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (agent_id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
          [agentRow.role, publicUrl],
        );

        json(res, 200, { success: true, avatar_url: publicUrl });
      } catch (uploadErr) {
        console.error('[server] Avatar upload failed:', uploadErr);
        json(res, 500, { success: false, error: 'Failed to upload avatar' });
      }
      return;
    }

    // Get code-defined system prompt for an agent
    const promptMatch = url.match(/^\/agents\/([^/]+)\/system-prompt$/);
    if (method === 'GET' && promptMatch) {
      const role = decodeURIComponent(promptMatch[1]);
      const prompt = SYSTEM_PROMPTS[role];
      json(res, 200, { role, source: prompt ? 'code' : 'none', system_prompt: prompt ?? null });
      return;
    }

    // Pause agent
    const pauseMatch = url.match(/^\/agents\/([^/]+)\/pause$/);
    if (method === 'POST' && pauseMatch) {
      const agentId = decodeURIComponent(pauseMatch[1]);
      await systemQuery('UPDATE company_agents SET status=$1, updated_at=$2 WHERE id=$3', ['paused', new Date().toISOString(), agentId]);
      json(res, 200, { success: true });
      return;
    }

    // Resume agent
    const resumeMatch = url.match(/^\/agents\/([^/]+)\/resume$/);
    if (method === 'POST' && resumeMatch) {
      const agentId = decodeURIComponent(resumeMatch[1]);
      await systemQuery('UPDATE company_agents SET status=$1, updated_at=$2 WHERE id=$3', ['active', new Date().toISOString(), agentId]);
      json(res, 200, { success: true });
      return;
    }

    // Delete agent — soft-delete (retire) by default, hard-delete with ?hard=true
    const deleteMatch = url.match(/^\/agents\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const agentId = decodeURIComponent(deleteMatch[1]);
      const parsedUrl = new URL(req.url!, `http://${req.headers.host}`);
      const hard = parsedUrl.searchParams.get('hard') === 'true';

      if (hard) {
        // Look up agent email for Entra deletion
        const [agentRow] = await systemQuery('SELECT role, display_name FROM company_agents WHERE id::text=$1 OR role=$1', [agentId]);
        const agentRole = agentRow?.role ?? agentId;
        const agentEmail = `${agentRole.replace(/-/g, '.')}@glyphor.ai`;

        // Hard delete from all DB tables
        await systemQuery('DELETE FROM agent_schedules WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_briefs WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_profiles WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_reasoning_config WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_tool_grants WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM activity_log WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM company_agents WHERE id::text=$1 OR role=$1', [agentId]);

        // Remove from Entra (best-effort)
        try {
          const token = await getM365Token('write_directory');
          const graphRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(agentEmail)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (graphRes.ok || graphRes.status === 404) {
            console.log(`[server] Entra user ${agentEmail} deleted (${graphRes.status})`);
          } else {
            console.warn(`[server] Entra user ${agentEmail} delete failed: ${graphRes.status}`);
          }
        } catch (entraErr) {
          console.warn(`[server] Entra cleanup failed for ${agentEmail}:`, entraErr);
        }

        await systemQuery('INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)', ['system', 'system', 'agent.deleted', `Agent hard-deleted: ${agentRow?.display_name ?? agentId} (${agentRole})`, new Date().toISOString()]);
        json(res, 200, { success: true, deleted: true });
      } else {
        // Soft-delete (retire)
        await systemQuery('UPDATE company_agents SET status=$1, updated_at=$2 WHERE id=$3', ['retired', new Date().toISOString(), agentId]);
        await systemQuery('UPDATE agent_schedules SET enabled=$1 WHERE agent_id=$2', [false, agentId]);
        json(res, 200, { success: true });
      }
      return;
    }

    // ─── Analysis Engine Endpoints (v1 → Strategy Lab v2 redirect) ────

    // Launch analysis — redirects to Strategy Lab v2 engine
    if (method === 'POST' && url === '/analysis/run') {
      const body = JSON.parse(await readBody(req));
      const { type, query, depth, requestedBy } = body;
      const id = await strategyLabEngine.launch({
        query,
        analysisType: (type as StrategyAnalysisType) || 'competitive_landscape',
        depth: (depth ?? 'standard') as 'quick' | 'standard' | 'deep',
        requestedBy: requestedBy ?? 'dashboard',
      });
      json(res, 200, { success: true, id });
      return;
    }

    // Get analysis status/result
    const analysisGetMatch = url.match(/^\/analysis\/([^/]+)$/);
    if (method === 'GET' && analysisGetMatch) {
      const id = decodeURIComponent(analysisGetMatch[1]);
      const record = await analysisEngine.get(id);
      if (!record) { json(res, 404, { error: 'Analysis not found' }); return; }
      json(res, 200, record);
      return;
    }

    // List analyses — redirects to Strategy Lab v2
    if (method === 'GET' && url === '/analysis') {
      const records = await strategyLabEngine.list();
      json(res, 200, records);
      return;
    }

    // Export analysis report
    const analysisExportMatch = url.match(/^\/analysis\/([^/]+)\/export$/);
    if (method === 'GET' && analysisExportMatch) {
      const id = decodeURIComponent(analysisExportMatch[1]);
      const record = await analysisEngine.get(id);
      if (!record) { json(res, 404, { error: 'Analysis not found' }); return; }

      const format = params.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="analysis-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportAnalysisJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportAnalysisPPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="analysis-${id}.pptx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportAnalysisDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="analysis-${id}.docx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="analysis-${id}.md"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportAnalysisMarkdown(record));
      }
      return;
    }

    // Cancel / mark stuck analysis as failed
    const analysisCancelMatch = url.match(/^\/analysis\/([^/]+)\/cancel$/);
    if (method === 'POST' && analysisCancelMatch) {
      const id = decodeURIComponent(analysisCancelMatch[1]);
      const record = await analysisEngine.get(id);
      if (!record) { json(res, 404, { error: 'Analysis not found' }); return; }
      if (record.status === 'completed' || record.status === 'failed') {
        json(res, 400, { error: `Analysis already ${record.status}` });
        return;
      }
      await analysisEngine.cancel(id);
      json(res, 200, { success: true, id });
      return;
    }

    // Enhance analysis (executive-grade deep-dive with additional perspectives)
    const analysisEnhanceMatch = url.match(/^\/analysis\/([^/]+)\/enhance$/);
    if (method === 'POST' && analysisEnhanceMatch) {
      const id = decodeURIComponent(analysisEnhanceMatch[1]);
      await analysisEngine.enhance(id);
      json(res, 200, { success: true, id });
      return;
    }

    // Get saved AI visual for analysis
    const analysisVisualGetMatch = url.match(/^\/analysis\/([^/]+)\/visual$/);
    if (method === 'GET' && analysisVisualGetMatch) {
      const id = decodeURIComponent(analysisVisualGetMatch[1]);
      const [row] = await systemQuery<{ visual_image: string | null }>('SELECT visual_image FROM analyses WHERE id=$1', [id]);
      if (row?.visual_image) {
        json(res, 200, { image: row.visual_image, mimeType: 'image/png' });
      } else {
        json(res, 404, { error: 'No visual saved' });
      }
      return;
    }

    // Generate AI visual (PNG infographic via OpenAI image generation)
    const analysisVisualMatch = url.match(/^\/analysis\/([^/]+)\/visual$/);
    if (method === 'POST' && analysisVisualMatch) {
      const id = decodeURIComponent(analysisVisualMatch[1]);
      const record = await analysisEngine.get(id);
      if (!record?.report) { json(res, 404, { error: 'Analysis not found or not completed' }); return; }

      const prompt = buildVisualPrompt(record);
      const imageResponse = await strategyModelClient.generateImageOpenAI(prompt);

      // Apply logo watermark and save to DB
      const watermarked = await applyWatermark(imageResponse.imageData);
      await systemQuery('UPDATE analyses SET visual_image=$1 WHERE id=$2', [watermarked, id]);

      json(res, 200, { image: watermarked, mimeType: 'image/png' });
      return;
    }

    // ─── Simulation Engine Endpoints ────────────────────────────

    // Launch simulation
    if (method === 'POST' && url === '/simulation/run') {
      const body = JSON.parse(await readBody(req));
      const { action, perspective, requestedBy } = body;
      const id = await simulationEngine.launch({
        action,
        perspective: perspective ?? 'neutral',
        requestedBy: requestedBy ?? 'dashboard',
      });
      json(res, 200, { success: true, id });
      return;
    }

    // Get simulation status/result
    const simGetMatch = url.match(/^\/simulation\/([^/]+)$/);
    if (method === 'GET' && simGetMatch && !url.includes('/accept') && !url.includes('/export')) {
      const id = decodeURIComponent(simGetMatch[1]);
      const record = await simulationEngine.get(id);
      if (!record) { json(res, 404, { error: 'Simulation not found' }); return; }
      json(res, 200, record);
      return;
    }

    // List simulations
    if (method === 'GET' && url === '/simulation') {
      const records = await simulationEngine.list();
      json(res, 200, records);
      return;
    }

    // Accept simulation result
    const simAcceptMatch = url.match(/^\/simulation\/([^/]+)\/accept$/);
    if (method === 'POST' && simAcceptMatch) {
      const id = decodeURIComponent(simAcceptMatch[1]);
      const body = JSON.parse(await readBody(req));
      await simulationEngine.accept(id, body.acceptedBy ?? 'founder');
      json(res, 200, { success: true });
      return;
    }

    // Export simulation report
    const simExportMatch = url.match(/^\/simulation\/([^/]+)\/export$/);
    if (method === 'GET' && simExportMatch) {
      const id = decodeURIComponent(simExportMatch[1]);
      const record = await simulationEngine.get(id);
      if (!record) { json(res, 404, { error: 'Simulation not found' }); return; }

      const format = params.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="simulation-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportSimulationJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportSimulationPPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="simulation-${id}.pptx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportSimulationDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="simulation-${id}.docx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="simulation-${id}.md"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportSimulationMarkdown(record));
      }
      return;
    }

    // ─── Meeting Engine Endpoints ─────────────────────────────

    // Call a meeting
    if (method === 'POST' && url === '/meetings/call') {
      const body = JSON.parse(await readBody(req));
      const { title, purpose, calledBy, attendees, meetingType, rounds, agenda } = body;
      const id = await meetingEngine.launch({
        title,
        purpose,
        calledBy: calledBy ?? 'chief-of-staff',
        attendees: attendees ?? [],
        meetingType: meetingType ?? 'discussion',
        rounds,
        agenda,
      });
      json(res, 200, { success: true, id });
      return;
    }

    // Get meeting by ID
    const meetingGetMatch = url.match(/^\/meetings\/([^/]+)$/);
    if (method === 'GET' && meetingGetMatch) {
      const id = decodeURIComponent(meetingGetMatch[1]);
      const record = await meetingEngine.get(id);
      if (!record) { json(res, 404, { error: 'Meeting not found' }); return; }
      json(res, 200, record);
      return;
    }

    // List meetings
    if (method === 'GET' && url === '/meetings') {
      const records = await meetingEngine.list();
      json(res, 200, records);
      return;
    }

    // ─── Chain of Thought Endpoints ─────────────────────────────

    // Launch CoT analysis
    if (method === 'POST' && url === '/cot/run') {
      const body = JSON.parse(await readBody(req));
      const { query, requestedBy } = body;
      const id = await cotEngine.launch(query, requestedBy ?? 'dashboard');
      json(res, 200, { success: true, id });
      return;
    }

    // Get CoT by ID
    const cotGetMatch = url.match(/^\/cot\/([^/]+)$/);
    if (method === 'GET' && cotGetMatch && !url.includes('/export')) {
      const id = decodeURIComponent(cotGetMatch[1]);
      const record = await cotEngine.get(id);
      if (!record) { json(res, 404, { error: 'CoT analysis not found' }); return; }
      json(res, 200, record);
      return;
    }

    // List CoT analyses
    if (method === 'GET' && url === '/cot') {
      const records = await cotEngine.list();
      json(res, 200, records);
      return;
    }

    // Export CoT report
    const cotExportMatch = url.match(/^\/cot\/([^/]+)\/export$/);
    if (method === 'GET' && cotExportMatch) {
      const id = decodeURIComponent(cotExportMatch[1]);
      const record = await cotEngine.get(id);
      if (!record) { json(res, 404, { error: 'CoT analysis not found' }); return; }

      const format = params.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="cot-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportCotJSON(record));
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="cot-${id}.md"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportCotMarkdown(record));
      }
      return;
    }

    // ─── Deep Dive Engine Endpoints ───────────────────────────

    // Launch deep dive
    if (method === 'POST' && url === '/deep-dive/run') {
      const body = JSON.parse(await readBody(req));
      const { target, context: ddContext, requestedBy } = body;
      if (!target) { json(res, 400, { error: 'target is required' }); return; }
      const { id: ddId, completion } = await deepDiveEngine.launch({
        target,
        context: ddContext,
        requestedBy: requestedBy ?? 'dashboard',
      });
      // Send the ID back to the dashboard immediately so it can start polling.
      // Write the response body but DON'T call res.end() yet — keeping the HTTP
      // connection open prevents Cloud Run from scaling down the instance while
      // the deep dive research is running in the background.
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(JSON.stringify({ success: true, id: ddId }));
      await completion;
      res.end();
      return;
    }

    // List deep dives
    if (method === 'GET' && url === '/deep-dive') {
      const records = await deepDiveEngine.list();
      json(res, 200, records);
      return;
    }

    // Get deep dive by ID
    const ddGetMatch = url.match(/^\/deep-dive\/([^/]+)$/);
    if (method === 'GET' && ddGetMatch && !url.includes('/export')) {
      const ddId = decodeURIComponent(ddGetMatch[1]);
      const record = await deepDiveEngine.get(ddId);
      if (!record) { json(res, 404, { error: 'Deep dive not found' }); return; }
      json(res, 200, record);
      return;
    }

    // Cancel deep dive
    const ddCancelMatch = url.match(/^\/deep-dive\/([^/]+)\/cancel$/);
    if (method === 'POST' && ddCancelMatch) {
      const ddId = decodeURIComponent(ddCancelMatch[1]);
      await deepDiveEngine.cancel(ddId);
      json(res, 200, { success: true });
      return;
    }

    // Export deep dive report
    const ddExportMatch = url.match(/^\/deep-dive\/([^/]+)\/export$/);
    if (method === 'GET' && ddExportMatch) {
      const ddId = decodeURIComponent(ddExportMatch[1]);
      const record = await deepDiveEngine.get(ddId);
      if (!record) { json(res, 404, { error: 'Deep dive not found' }); return; }

      const format = params.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportDeepDiveJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportDeepDivePPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.pptx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportDeepDiveDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.docx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.md"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportDeepDiveMarkdown(record));
      }
      return;
    }

    // Get saved deep dive visual
    const ddVisualGetMatch = url.match(/^\/deep-dive\/([^/]+)\/visual$/);
    if (method === 'GET' && ddVisualGetMatch) {
      const ddId = decodeURIComponent(ddVisualGetMatch[1]);
      const [ddRow] = await systemQuery<{ visual_image: string | null }>('SELECT visual_image FROM deep_dives WHERE id=$1', [ddId]);
      if (ddRow?.visual_image) {
        json(res, 200, { image: ddRow.visual_image, mimeType: 'image/png' });
      } else {
        json(res, 404, { error: 'No visual saved' });
      }
      return;
    }

    // Generate deep dive AI visual
    const ddVisualMatch = url.match(/^\/deep-dive\/([^/]+)\/visual$/);
    if (method === 'POST' && ddVisualMatch) {
      const ddId = decodeURIComponent(ddVisualMatch[1]);
      const record = await deepDiveEngine.get(ddId);
      if (!record?.report) { json(res, 404, { error: 'Deep dive not found or not completed' }); return; }

      const prompt = buildDeepDiveVisualPrompt(record);
      const imageResponse = await strategyModelClient.generateImageOpenAI(prompt);

      // Apply logo watermark and save to DB
      const watermarked = await applyWatermark(imageResponse.imageData);
      await systemQuery('UPDATE deep_dives SET visual_image=$1 WHERE id=$2', [watermarked, ddId]);

      json(res, 200, { image: watermarked, mimeType: 'image/png' });
      return;
    }

    // ─── Strategy Lab v2 Endpoints ──────────────────────────────

    // Launch a strategy analysis
    if (method === 'POST' && url === '/strategy-lab/run') {
      const body = JSON.parse(await readBody(req));
      const { query, analysisType, depth, requestedBy } = body;
      if (!query) { json(res, 400, { error: 'query is required' }); return; }
      const id = await strategyLabEngine.launch({
        query,
        analysisType: analysisType || 'competitive_landscape',
        depth: depth || 'standard',
        requestedBy: requestedBy || 'api',
      });
      json(res, 200, { id, status: 'planning' });
      return;
    }

    // List strategy analyses
    if (method === 'GET' && url === '/strategy-lab') {
      const analyses = await strategyLabEngine.list();
      json(res, 200, analyses);
      return;
    }

    // Get single strategy analysis
    const strategyLabGetMatch = url.match(/^\/strategy-lab\/([^/]+)$/);
    if (method === 'GET' && strategyLabGetMatch) {
      const id = decodeURIComponent(strategyLabGetMatch[1]);
      const record = await strategyLabEngine.get(id);
      if (!record) { json(res, 404, { error: 'Strategy analysis not found' }); return; }
      json(res, 200, record);
      return;
    }

    // Cancel a strategy analysis
    const strategyLabCancelMatch = url.match(/^\/strategy-lab\/([^/]+)\/cancel$/);
    if (method === 'POST' && strategyLabCancelMatch) {
      const id = decodeURIComponent(strategyLabCancelMatch[1]);
      await strategyLabEngine.cancel(id);
      json(res, 200, { success: true });
      return;
    }

    // Export strategy analysis
    const strategyLabExportMatch = url.match(/^\/strategy-lab\/([^/]+)\/export$/);
    if (method === 'GET' && strategyLabExportMatch) {
      const id = decodeURIComponent(strategyLabExportMatch[1]);
      const record = await strategyLabEngine.get(id);
      if (!record?.synthesis) { json(res, 404, { error: 'Strategy analysis not found or not completed' }); return; }
      const format = params.get('format') || 'json';
      if (format === 'json') {
        json(res, 200, record);
      } else if (format === 'pptx') {
        const buffer = await exportStrategyLabPPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="strategy-${id}.pptx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportStrategyLabDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="strategy-${id}.docx"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buffer);
      } else {
        // Markdown export
        const md = exportStrategyLabMarkdown(record);
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="strategy-${id}.md"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(md);
      }
      return;
    }

    // Get saved AI visual for strategy analysis
    const strategyLabVisualGetMatch = url.match(/^\/strategy-lab\/([^/]+)\/visual$/);
    if (method === 'GET' && strategyLabVisualGetMatch) {
      const id = decodeURIComponent(strategyLabVisualGetMatch[1]);
      const [saRow] = await systemQuery<{ visual_image: string | null }>('SELECT visual_image FROM strategy_analyses WHERE id=$1', [id]);
      if (saRow?.visual_image) {
        json(res, 200, { image: saRow.visual_image, mimeType: 'image/png' });
      } else {
        json(res, 404, { error: 'No visual saved' });
      }
      return;
    }

    // Generate AI visual for strategy analysis
    const strategyLabVisualMatch = url.match(/^\/strategy-lab\/([^/]+)\/visual$/);
    if (method === 'POST' && strategyLabVisualMatch) {
      const id = decodeURIComponent(strategyLabVisualMatch[1]);
      const record = await strategyLabEngine.get(id);
      if (!record?.synthesis) { json(res, 404, { error: 'Strategy analysis not found or not completed' }); return; }

      const prompt = buildStrategyLabVisualPrompt(record);
      const imageResponse = await strategyModelClient.generateImageOpenAI(prompt);

      const watermarked = await applyWatermark(imageResponse.imageData);
      await systemQuery('UPDATE strategy_analyses SET visual_image=$1 WHERE id=$2', [watermarked, id]);

      json(res, 200, { image: watermarked, mimeType: 'image/png' });
      return;
    }

    // ─── Message Endpoints ──────────────────────────────────────

    // Send a message (via API, not tool)
    if (method === 'POST' && url === '/messages/send') {
      const body = JSON.parse(await readBody(req));
      const { from_agent, to_agent, message, message_type, priority, thread_id } = body;
      let data;
      try {
        [data] = await systemQuery<{ id: string; thread_id: string }>(
          'INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, thread_id',
          [from_agent, to_agent, thread_id ?? crypto.randomUUID(), message, message_type ?? 'info', priority ?? 'normal', 'pending'],
        );
      } catch (msgErr) {
        json(res, 400, { success: false, error: (msgErr as Error).message });
        return;
      }

      // Reactive wake: wake target agent immediately for urgent messages
      if (priority === 'urgent') {
        wakeRouter.processEvent({
          type: 'agent_message',
          data: { to_agent, from_agent, message, priority },
          source: 'internal',
        }).catch(() => { /* best-effort */ });
      }

      json(res, 200, { success: true, ...data });
      return;
    }

    // Get messages for an agent
    const messagesForAgentMatch = url.match(/^\/messages\/agent\/([^/]+)$/);
    if (method === 'GET' && messagesForAgentMatch) {
      const agentRole = decodeURIComponent(messagesForAgentMatch[1]);
      const data = await systemQuery('SELECT * FROM agent_messages WHERE from_agent=$1 OR to_agent=$1 ORDER BY created_at DESC LIMIT 50', [agentRole]);
      json(res, 200, data);
      return;
    }

    // Get all recent messages
    if (method === 'GET' && url === '/messages') {
      const data = await systemQuery('SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT 50', []);
      json(res, 200, data);
      return;
    }

    // ─── Collective Intelligence Endpoints ────────────────────

    // Get company pulse
    if (method === 'GET' && url === '/pulse') {
      const ci = memory.getCollectiveIntelligence();
      const pulse = await ci.getPulse();
      json(res, 200, pulse);
      return;
    }

    // Get org-level company knowledge
    if (method === 'GET' && url === '/knowledge/company') {
      const ci = memory.getCollectiveIntelligence();
      const knowledge = await ci.getCompanyKnowledge();
      json(res, 200, knowledge);
      return;
    }

    // Get active knowledge routes
    if (method === 'GET' && url === '/knowledge/routes') {
      const ci = memory.getCollectiveIntelligence();
      const routes = await ci.getActiveRoutes();
      json(res, 200, routes);
      return;
    }

    // Create a knowledge route
    if (method === 'POST' && url === '/knowledge/routes') {
      const body = JSON.parse(await readBody(req));
      const ci = memory.getCollectiveIntelligence();
      const route = await ci.createRoute(body);
      // Invalidate knowledge caches
      getRedisCache().invalidatePattern('jit:knowledge:*').catch(() => {});
      json(res, 200, { success: true, route });
      return;
    }

    // Get authority proposals
    if (method === 'GET' && url === '/authority/proposals') {
      const ci = memory.getCollectiveIntelligence();
      const proposals = await ci.getAuthorityProposals();
      json(res, 200, proposals);
      return;
    }

    // Resolve an authority proposal
    const proposalResolveMatch = url.match(/^\/authority\/proposals\/([^/]+)\/resolve$/);
    if (method === 'POST' && proposalResolveMatch) {
      const proposalId = decodeURIComponent(proposalResolveMatch[1]);
      const body = JSON.parse(await readBody(req));
      const ci = memory.getCollectiveIntelligence();
      await ci.resolveAuthorityProposal(proposalId, body.status);
      json(res, 200, { success: true });
      return;
    }

    // Get process patterns
    if (method === 'GET' && url === '/knowledge/patterns') {
      const ci = memory.getCollectiveIntelligence();
      const patterns = await ci.getProcessPatterns();
      json(res, 200, patterns);
      return;
    }

    // Detect contradictions
    if (method === 'GET' && url === '/knowledge/contradictions') {
      const ci = memory.getCollectiveIntelligence();
      const contradictions = await ci.detectContradictions();
      json(res, 200, contradictions);
      return;
    }

    // ─── DIRECTIVES CRUD ──────────────────────────────────────

    // List directives (with optional status filter)
    if (method === 'GET' && url.startsWith('/directives')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const status = params.get('status') || 'active';

      try {
        const directives = status !== 'all'
          ? await systemQuery('SELECT * FROM founder_directives WHERE status=$1 ORDER BY priority ASC, created_at DESC', [status])
          : await systemQuery('SELECT * FROM founder_directives ORDER BY priority ASC, created_at DESC', []);
        // Attach work_assignments per directive
        for (const d of directives as Record<string, unknown>[]) {
          (d as Record<string, unknown>).work_assignments = await systemQuery('SELECT * FROM work_assignments WHERE directive_id=$1', [d.id]);
        }
        json(res, 200, directives);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Create directive
    if (method === 'POST' && url === '/directives') {
      const body = JSON.parse(await readBody(req));
      try {
        const [data] = await systemQuery(
          'INSERT INTO founder_directives (title, description, priority, category, target_agents, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [body.title, body.description, body.priority || 'high', body.category || 'general', JSON.stringify(body.target_agents || []), body.due_date || null, body.created_by || 'kristina'],
        );
        // Invalidate directive/context caches
        getRedisCache().invalidatePattern('jit:directives:*').catch(() => {});
        json(res, 201, data);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Update directive
    const directivePatchMatch = url.match(/^\/directives\/([^/?]+)$/);
    if (method === 'PATCH' && directivePatchMatch) {
      const id = decodeURIComponent(directivePatchMatch[1]);
      const body = JSON.parse(await readBody(req));
      body.updated_at = new Date().toISOString();
      try {
        const keys = Object.keys(body);
        const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        const values = keys.map(k => body[k]);
        values.push(id);
        const [data] = await systemQuery(`UPDATE founder_directives SET ${setClause} WHERE id=$${keys.length + 1} RETURNING *`, values);
        // Invalidate directive/context caches
        getRedisCache().invalidatePattern('jit:directives:*').catch(() => {});
        json(res, 200, data);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Delete directive
    const directiveDeleteMatch = url.match(/^\/directives\/([^/?]+)$/);
    if (method === 'DELETE' && directiveDeleteMatch) {
      const id = decodeURIComponent(directiveDeleteMatch[1]);
      try {
        const { cascadeDeleteDirective: cascadeDel } = await import('./dashboardApi.js');
        await cascadeDel(id);
        // Invalidate directive/context caches
        getRedisCache().invalidatePattern('jit:directives:*').catch(() => {});
        json(res, 200, { success: true });
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // ── Workflow Orchestrator endpoints ──────────────────────────────

    // List workflows (filterable by status, type)
    if (method === 'GET' && url === '/workflows') {
      try {
        const status = params.get('status') as WorkflowStatus | null;
        const type = params.get('type');
        let query = 'SELECT id, type, status, initiator_role, directive_id, current_step_index, created_at, completed_at FROM workflows';
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (status) { conditions.push(`status=$${conditions.length + 1}`); values.push(status); }
        if (type) { conditions.push(`type=$${conditions.length + 1}`); values.push(type); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY created_at DESC LIMIT 50';
        const rows = await systemQuery(query, values);
        json(res, 200, rows);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Get workflow state + steps
    const workflowGetMatch = url.match(/^\/workflows\/([^/?]+)$/);
    if (method === 'GET' && workflowGetMatch) {
      const wfId = decodeURIComponent(workflowGetMatch[1]);
      try {
        const wo = new WorkflowOrchestrator();
        const state = await wo.getWorkflowState(wfId);
        json(res, 200, state);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes('not found')) { json(res, 404, { error: msg }); }
        else { json(res, 500, { error: msg }); }
      }
      return;
    }

    // Cancel a running workflow
    const workflowCancelMatch = url.match(/^\/workflows\/([^/?]+)\/cancel$/);
    if (method === 'POST' && workflowCancelMatch) {
      const wfId = decodeURIComponent(workflowCancelMatch[1]);
      try {
        const body = JSON.parse(await readBody(req).catch(() => '{}'));
        const wo = new WorkflowOrchestrator();
        await wo.cancelWorkflow(wfId, body.reason ?? 'Cancelled via API');
        json(res, 200, { success: true });
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Retry a failed workflow from last failed step
    const workflowRetryMatch = url.match(/^\/workflows\/([^/?]+)\/retry$/);
    if (method === 'POST' && workflowRetryMatch) {
      const wfId = decodeURIComponent(workflowRetryMatch[1]);
      try {
        const wo = new WorkflowOrchestrator();
        const state = await wo.getWorkflowState(wfId);
        if (state.status !== 'failed') {
          json(res, 400, { error: `Workflow is ${state.status}, not failed` });
          return;
        }
        const failedStep = state.steps.find(s => s.status === 'failed');
        if (!failedStep) {
          json(res, 400, { error: 'No failed step found to retry' });
          return;
        }
        // Reset workflow to running and retry from the failed step
        await systemQuery(
          `UPDATE workflows SET status = 'running', completed_at = NULL WHERE id = $1`,
          [wfId],
        );
        await systemQuery(
          `UPDATE workflow_steps SET status = 'pending', error = NULL, completed_at = NULL WHERE workflow_id = $1 AND step_index = $2`,
          [wfId, failedStep.index],
        );
        // Re-advance from the step before the failed one
        if (failedStep.index > 0) {
          const prevStep = state.steps[failedStep.index - 1];
          await wo.advanceWorkflow(wfId, failedStep.index - 1, { output: prevStep.output ?? {} });
        } else {
          // Failed on step 0 — dispatch step 0 again via a fresh start-like reset
          const [stepRow] = await systemQuery<{ step_type: string; step_config: Record<string, unknown> }>(
            `SELECT step_type, step_config FROM workflow_steps WHERE workflow_id = $1 AND step_index = 0`,
            [wfId],
          );
          if (stepRow) {
            await systemQuery(
              `UPDATE workflow_steps SET status = 'running', started_at = NOW() WHERE workflow_id = $1 AND step_index = 0`,
              [wfId],
            );
          }
        }
        json(res, 200, { success: true, retrying_step: failedStep.index });
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // ── Plan re-verify endpoint ───────────────────────────────────
    const planVerifyMatch = url.match(/^\/plan-verify\/([^/?]+)$/);
    if (method === 'POST' && planVerifyMatch) {
      const directiveId = decodeURIComponent(planVerifyMatch[1]);
      try {
        const [directive] = await systemQuery<Record<string, unknown>>(
          'SELECT id, title, description, priority, target_agents FROM founder_directives WHERE id=$1',
          [directiveId],
        );
        if (!directive) { json(res, 404, { error: 'Directive not found' }); return; }

        const assignments = await systemQuery<Record<string, unknown>>(
          'SELECT assigned_to, task_description, expected_output, sequence_order FROM work_assignments WHERE directive_id=$1 ORDER BY sequence_order',
          [directiveId],
        );

        const result = await verifyPlan({
          directive: {
            id: directive.id as string,
            title: directive.title as string,
            description: directive.description as string,
            priority: directive.priority as string,
            target_agents: directive.target_agents as string[] | undefined,
          },
          proposed_assignments: assignments.map((a, i) => ({
            assigned_to: a.assigned_to as string,
            task_description: a.task_description as string,
            expected_output: (a.expected_output as string) ?? '',
            sequence_order: (a.sequence_order as number) ?? i,
          })),
        }, { skipLlm: true });

        json(res, 200, result);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // ─── Triangulated Chat ─────────────────────────────────────────
    if (method === 'POST' && (url === '/ora/chat' || url === '/chat/triangulate')) {
      await handleTriangulatedChat(req, res, {
        modelClient: strategyModelClient,
        embeddingClient: { embed: async (_text: string) => [] as number[] },
        redisCache: getRedisCache(),
      });
      return;
    }

    // ── Dashboard CRUD API (/api/*) ────────────────────────────────
    if (await handleDashboardApi(req, res, url, queryString ?? '', method)) return;

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

/* ── Deep Dive Visual Prompt ─────────────── */

function buildDeepDiveVisualPrompt(record: import('./deepDiveEngine.js').DeepDiveRecord): string {
  const r = record.report;
  if (!r) return '';

  const competitorCount = r.competitiveLandscape.competitors.length;
  const recCount = Math.min(r.strategicRecommendations.length, 4);
  const roadmapPhases = r.implementationRoadmap.length;
  const riskCount = r.riskAssessment.length;
  const totalSources = r.documentCounts.secFilings + r.documentCounts.newsArticles + r.documentCounts.patents + r.documentCounts.researchSources;
  const fs = r.currentState.financialSnapshot;

  // Extract 2-3 key financial numbers for large callouts
  const finStats: string[] = [];
  if (fs.revenue) finStats.push(fs.revenue);
  if (fs.revenueGrowth) finStats.push(fs.revenueGrowth);
  if (fs.valuation) finStats.push(fs.valuation);

  const momentumIcon = r.currentState.momentum === 'positive' ? '▲' : r.currentState.momentum === 'negative' ? '▼' : '►';
  const momentumColor = r.currentState.momentum === 'positive' ? 'green' : r.currentState.momentum === 'negative' ? 'red' : 'amber';

  return [
    `Create a polished, magazine-quality corporate infographic in 16:9 landscape format (1536x1024px).`,
    `Style: clean modern flat design, white background, generous whitespace, minimal text. Use large icons, bold number callouts, color blocks, and data visualizations. Think executive consulting slide deck — NOT a text document.`,
    ``,
    `Color palette: primary cyan (#00E0FF), white (#FFFFFF) background, dark charcoal (#1A1A2E) text, emerald (#34D399) for positive, rose (#FB7185) for negative, amber (#FBBF24) for caution.`,
    ``,
    `LAYOUT (3 rows):`,
    ``,
    `ROW 1 — Header (10% height):`,
    `Full-width dark charcoal banner with bold white title: "${r.targetName.toUpperCase()} — DEEP DIVE". Small cyan accent line below. Tiny gray text: "${totalSources} sources analyzed".`,
    ``,
    `ROW 2 — Main content (60% height), 3 equal columns separated by thin gray dividers:`,
    ``,
    `COLUMN 1 — "Financials":`,
    finStats.length > 0
      ? `Show ${finStats.length} large bold cyan numbers stacked vertically: ${finStats.map(s => `"${s}"`).join(', ')}. Each with a tiny gray label above (Revenue, Growth, etc). Below, a large ${momentumColor} ${momentumIcon} momentum arrow icon.`
      : `Show a large "—" dash with "Data Pending" label. Below, a neutral ${momentumIcon} arrow icon.`,
    `NO paragraphs. Just big numbers and icons.`,
    ``,
    `COLUMN 2 — "Market":`,
    `A nested concentric circle / bullseye diagram in 3 shades of cyan (dark→light):`,
    `• Outer ring labeled "TAM" with value "${r.marketAnalysis.tam.value}"`,
    `• Middle ring labeled "SAM" with value "${r.marketAnalysis.sam.value}"`,
    `• Inner circle labeled "SOM" with value "${r.marketAnalysis.som.value}"`,
    `Below: small text "Growth: ${r.marketAnalysis.growthRate}". That's ALL the text.`,
    ``,
    `COLUMN 3 — "Competitive":`,
    `A horizontal bar chart or icon grid showing ${competitorCount} competitors as colored bars/blocks of varying lengths. Each bar has ONLY the company name (1-2 words, no descriptions). Use a gradient from cyan to charcoal.`,
    ``,
    `ROW 3 — Bottom strip (30% height), 3 sections:`,
    ``,
    `LEFT (40%): "${recCount} Recommendations" — show as ${recCount} large numbered circles (1, 2, 3, 4) in a horizontal row. Color-code by priority: immediate=red, short-term=amber, medium-term=blue. Below each circle, ONE word label only.`,
    ``,
    `CENTER (30%): "Roadmap" — a horizontal timeline with ${roadmapPhases} connected nodes/dots. Each node has ONLY the phase name (1-2 words). Color gradient from cyan to emerald.`,
    ``,
    `RIGHT (30%): "Risk" — a small 2x2 heatmap grid (Impact vs Probability) with ${riskCount} colored dots plotted on it. Red for high-high, amber for medium, green for low. NO text labels on individual risks.`,
    ``,
    `CRITICAL RULES:`,
    `- MINIMAL TEXT. Maximum 35 words total on the infographic (excluding title).`,
    `- Use icons, shapes, charts, numbers, and color to convey information.`,
    `- No sentences, no paragraphs, no bullet-point lists.`,
    `- All text must be crisp, readable sans-serif.`,
    `- Professional, clean, corporate aesthetic.`,
    `- Do NOT include any "Powered by" branding or logo.`,
  ].join('\n');
}

/* ── Strategy Lab v2 Markdown Export ─────────────── */

function exportStrategyLabMarkdown(record: import('./strategyLabEngine.js').StrategyAnalysisRecord): string {
  const s = record.synthesis;
  if (!s) return `# Strategy Analysis: ${record.query}\n\n_Analysis not yet completed._`;

  const lines: string[] = [
    `# Strategy Analysis: ${record.query}`,
    ``,
    `**Type:** ${record.analysis_type} | **Depth:** ${record.depth} | **Sources:** ${record.total_sources} | **Searches:** ${record.total_searches}`,
    `**Date:** ${new Date(record.created_at).toLocaleDateString()}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    s.executiveSummary,
    ``,
    `## SWOT Analysis`,
    ``,
    `### Strengths`,
    ...s.unifiedSwot.strengths.map(i => `- ${i}`),
    ``,
    `### Weaknesses`,
    ...s.unifiedSwot.weaknesses.map(i => `- ${i}`),
    ``,
    `### Opportunities`,
    ...s.unifiedSwot.opportunities.map(i => `- ${i}`),
    ``,
    `### Threats`,
    ...s.unifiedSwot.threats.map(i => `- ${i}`),
    ``,
    `## Cross-Framework Insights`,
    ``,
    ...s.crossFrameworkInsights.map(i => `- ${i}`),
    ``,
    `## Strategic Recommendations`,
    ``,
  ];

  for (const rec of s.strategicRecommendations) {
    lines.push(`### ${rec.title}`);
    lines.push(`**Impact:** ${rec.impact} | **Feasibility:** ${rec.feasibility} | **Owner:** ${rec.owner}`);
    lines.push(``);
    lines.push(rec.description);
    lines.push(``);
    lines.push(`- **Expected Outcome:** ${rec.expectedOutcome}`);
    lines.push(`- **Risk if Not:** ${rec.riskIfNot}`);
    lines.push(``);
  }

  lines.push(`## Key Risks`, ``);
  for (const risk of s.keyRisks) lines.push(`- ${risk}`);
  lines.push(``);

  lines.push(`## Open Questions for Founders`, ``);
  for (const q of s.openQuestionsForFounders) lines.push(`- ${q}`);

  return lines.join('\n');
}

server.listen(PORT, () => {
  console.log(`[Scheduler] Listening on port ${PORT}`);

  // Recover any analyses orphaned by a previous container restart
  analysisEngine.recoverStale().catch((err) =>
    console.error('[Scheduler] Failed to recover stale analyses:', err),
  );

  // Start dynamic scheduler for DB-defined cron jobs
  const dynamicScheduler = new DynamicScheduler(trackedAgentExecutor);
  dynamicScheduler.start();

  // Start data sync scheduler (fires DATA_SYNC_JOBS on their cron schedule)
  const dataSyncScheduler = new DataSyncScheduler(PORT);
  dataSyncScheduler.start();
});

// ─── Graceful shutdown ──────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Scheduler] SIGTERM received, shutting down gracefully...');
  try {
    chatSubscriptionManager?.stopAutoRenewal();
    graphChatHandler?.destroy();
  } catch { /* best-effort */ }
  try {
    const cache = getRedisCache();
    await cache.disconnect();
  } catch { /* best-effort */ }
  server.close(() => {
    console.log('[Scheduler] Server closed');
    process.exit(0);
  });
});
