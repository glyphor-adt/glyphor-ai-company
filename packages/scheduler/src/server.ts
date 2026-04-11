/**
 * Scheduler HTTP Server — Cloud Run entry point
 *
 * Listens for:
 * - POST /pubsub — Pub/Sub push messages (from Cloud Scheduler)
 * - POST /run    — Direct task invocation
 * - GET  /health — Health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AgentApplication, CloudAdapter, MemoryStorage, TurnContext, TurnState, authorizeJWT } from '@microsoft/agents-hosting';
import type { AuthConfiguration, Request as AgentHostingRequest } from '@microsoft/agents-hosting';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  GlyphorEventBus,
  ModelClient,
  buildDefaultExpectedOutputSchema,
  buildRequiredInputs,
  completeContractForTask,
  failContractForTask,
  getRedisCache,
  issueContract,
  promptCache,
  WorkflowOrchestrator,
  recordAgentRunCompleted,
} from '@glyphor/agent-runtime';
import type { CompanyAgentRole, AgentExecutionResult, GlyphorEvent, ConversationTurn, ConversationAttachment, WorkflowStatus } from '@glyphor/agent-runtime';
import { handleStripeWebhook, syncStripeAll, syncBillingToDB, syncMercuryAll, syncSharePointKnowledge, runGovernanceSync, GraphChatHandler, ChatSubscriptionManager, GraphTeamsClient, getM365Token, A365TeamsChatClient, handleDocuSignWebhook, DEFAULT_SYSTEM_TENANT_ID, buildTeamsInstallProof, canonicalTeamsWorkspaceKey, resolveVerifiedTeamsTenantBinding } from '@glyphor/integrations';
import { SYSTEM_PROMPTS } from '@glyphor/agents';
import { assertWorkAssignmentDispatchAllowed, getTierModel, isCanonicalKeepRole } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { verifyUserAccessToken } from '@glyphor/shared/auth';
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
import { runModelChecker } from './modelChecker.js';
import { validateModelConfig } from './modelValidator.js';

const DB_RUN_ID_TURN_PREFIX = '__db_run_id__:';
const ASSIGNMENT_ID_TURN_PREFIX = '__assignment_id__:';
const DIRECTIVE_ID_TURN_PREFIX = '__directive_id__:';
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
import { relayUrgentFounderReplyIfNeeded } from './urgentFounderRelay.js';
import { runEconomicsGuardrailNotify } from './economicsGuardrailNotify.js';
import { handleDashboardApi } from './dashboardApi.js';
import type { AuthenticatedDashboardUser } from './dashboardApi.js';
import { handleAbacAdminApi } from './abacAdminApi.js';
import { handleAutonomyAdminApi } from './autonomyAdminApi.js';
import { handleCapacityAdminApi } from './capacityAdminApi.js';
import { createContradictionAdminApi } from './contradictionAdminApi.js';
import { ContradictionProcessor } from './contradictionProcessor.js';
import { handleDecisionTraceAdminApi } from './decisionTraceAdminApi.js';
import { handleDepartmentAdminApi } from './departmentAdminApi.js';
import { handleDisclosureAdminApi } from './disclosureAdminApi.js';
import { handleHandoffContractAdminApi } from './handoffContractAdminApi.js';
import { handleGovernanceApi } from './governanceApi.js';
import { handleMetricsAdminApi } from './metricsAdminApi.js';
import { handleTemporalKnowledgeGraphAdminApi } from './temporalKnowledgeGraphAdminApi.js';
import { HandoffContractMonitor } from './handoffContractMonitor.js';
import { handleEvalApi } from './evalDashboard.js';
import { verifyPlan } from './planVerifier.js';
import { consolidateMemory } from './memoryConsolidator.js';
import {
  buildMemoryConsolidationPromptMessage,
  evaluateMemoryConsolidationGates,
  markMemoryConsolidationSuccess,
  releaseMemoryConsolidationLease,
  tryAcquireMemoryConsolidationLease,
} from './memoryConsolidationGates.js';
import { archiveExpiredMemory } from './memoryArchiver.js';
import { evaluateBatch } from './batchOutcomeEvaluator.js';
import { runShadow, getPendingShadowTasks, evaluatePromotion, getPendingChallengerVersions, getWorldStateHealth } from '@glyphor/agent-runtime';
import { evaluateCascadePredictions } from './cascadePredictionEvaluator.js';
import { resolvePredictionJournal } from './predictionResolver.js';
import { handleDirectiveApproval } from './directiveApproval.js';
import { expireTools } from './toolExpirationManager.js';
import { evaluateCanary } from './canaryEvaluator.js';
import { evaluateAgentKnowledgeGaps } from './agentKnowledgeEvaluator.js';
import { runGtmReadinessEval, persistGtmReport } from './gtmReadiness/index.js';
import { evaluatePlanningGateHealth } from './planningGateMonitor.js';
import { evaluateTrustQuality } from './trustQualityMonitor.js';
import { handleTriangulatedChat } from './triangulationEndpoint.js';
import { enqueueDeepDiveExecution, executeWorkerAgentRun, executeWorkerDeepDiveExecution, isWorkerQueueConfigured } from './workerQueue.js';
import { dispatchCiHealAgent, parseCiHealPayload, verifyCiHealBearer } from './ciHealWebhook.js';
import { processDailyAutonomyAdjustments } from '@glyphor/shared';
import {
  handleFounderRejection,
  handleIllegalAgentCreationRequest,
  handleMisroutedToolGap,
} from './worldModelUpdater.js';
import {
  authenticateSdkClient,
  createClientSdkAgent,
  getClientSdkAgent,
  listClientSdkAgents,
  retireClientSdkAgent,
} from './clientSdk.js';
import type { CTORunParams } from '@glyphor/agents';
import {
  runChiefOfStaff,
  runCTO,
  runCFO,
  runCPO,
  runCMO,
  runVPDesign,
  runVPResearch,
  runOps,
  resolveVpDesignWorkerMessage,
  type VPResearchRunParams,
} from '@glyphor/agents';
import { OAuth2Client } from 'google-auth-library';
import {
  buildDashboardConversationId,
  buildDashboardResultContent,
  normalizeDashboardRunRequest,
  type DashboardRunRequestBody,
} from './runtimeKernel.js';
import {
  appendRuntimeEvent,
  createRuntimeAttempt,
  ensureRuntimeSession,
  findSessionIdBySessionKey,
  markRuntimeAttemptRunning,
  markRuntimeAttemptTerminal,
  markRuntimeSessionTerminal,
  replayRuntimeEventsBySeq,
  resolveRuntimeCursorFromEventId,
} from './runtimeEventStore.js';
import { appendCorsHeaders, corsHeadersFor } from './corsHeaders.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const oidcClient = new OAuth2Client();

type SchedulerRouteClass =
  | 'public'
  | 'authenticated-user'
  | 'admin-only'
  | 'internal-service-only'
  | 'admin-or-internal'
  /** Cron OIDC or any logged-in dashboard user (viewer/admin)—used for golden-eval "run now" from Reliability UI */
  | 'internal-or-dashboard-user';

const DASHBOARD_FALLBACK_EMAILS = new Set([
  'kristina@glyphor.ai',
  'andrew@glyphor.ai',
  'devops@glyphor.ai',
  'andrew.zwelling@gmail.com',
]);

const DASHBOARD_FALLBACK_ADMINS = new Set([
  'kristina@glyphor.ai',
  'andrew@glyphor.ai',
  'andrew.zwelling@gmail.com',
  'devops@glyphor.ai',
]);

interface RouteAuthContext {
  routeClass: SchedulerRouteClass;
  dashboardUser: AuthenticatedDashboardUser | null;
}

// ─── Logo watermark ─────────────────────────────────────────────
const HEADER_LOGO_PATH = path.resolve(import.meta.dirname, '../../dashboard/public/glyphor_full_white.png');
const HEADER_LOGO_FALLBACK = path.resolve(import.meta.dirname, '../../../public/glyphor_full_white.png');
let headerLogoBuf: Buffer | null = null;
try {
  headerLogoBuf = fs.readFileSync(fs.existsSync(HEADER_LOGO_PATH) ? HEADER_LOGO_PATH : HEADER_LOGO_FALLBACK);
} catch { /* header logo not available — skip */ }

async function applyWatermark(imageB64: string): Promise<string> {
  const imgBuf = Buffer.from(imageB64, 'base64');
  const meta = await sharp(imgBuf).metadata();
  const imgW = meta.width ?? 1536;
  const imgH = meta.height ?? 1024;
  const footerH = Math.max(44, Math.round((imgH * 60) / 1024));
  const footerY = imgH - footerH;
  const footerText = '© Glyphor Corporation. All rights reserved.';

  // ── Header logo (top-right on header bar) ──
  const headerLogoMaxW = Math.max(180, Math.round((imgW * 260) / 1536));
  const headerLogoMaxH = Math.max(40, Math.round((imgH * 56) / 1024));
  let headerLogo: Buffer | null = null;
  let headerLogoW = 0;
  let headerLogoH = 0;

  if (headerLogoBuf) {
    headerLogo = await sharp(headerLogoBuf)
      .resize({ width: headerLogoMaxW, height: headerLogoMaxH, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const hlMeta = await sharp(headerLogo).metadata();
    headerLogoW = hlMeta.width ?? headerLogoMaxW;
    headerLogoH = hlMeta.height ?? headerLogoMaxH;
  }

  const footerSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${footerH}" viewBox="0 0 ${imgW} ${footerH}">
      <rect width="${imgW}" height="${footerH}" fill="#000000"/>
      <text
        x="${Math.round(imgW / 2)}"
        y="${Math.round(footerH / 2)}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Segoe UI, Arial, sans-serif"
        font-size="${Math.max(12, Math.round((imgW * 16) / 1536))}"
        fill="#FFFFFF"
      >${footerText}</text>
    </svg>
  `);
  const composites: sharp.OverlayOptions[] = [
    {
      input: footerSvg,
      left: 0,
      top: footerY,
    },
  ];

  // Header logo — top-right corner on the header bar
  if (headerLogo) {
    const headerPad = Math.max(16, Math.round((imgW * 24) / 1536));
    const headerBarH = Math.round(imgH * 0.08);
    composites.push({
      input: headerLogo,
      left: imgW - headerLogoW - headerPad,
      top: Math.max(headerPad, Math.round((headerBarH - headerLogoH) / 2)),
    });
  }

  const result = await sharp(imgBuf)
    .composite(composites)
    .png()
    .toBuffer();
  return result.toString('base64');
}

function escapeSvgText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapSvgLine(value: string, maxChars = 46): string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function sanitizeVisualText(input: string, fallback: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return fallback;

  // The SVG fallback uses system sans fonts that may not support all scripts in Cloud Run.
  // Keep text in a broadly supported ASCII subset to avoid tofu squares in generated PNGs.
  const asciiSafe = normalized.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return asciiSafe || fallback;
}

async function buildStrategyFallbackVisualPng(
  record: import('./strategyLabEngine.js').StrategyAnalysisRecord,
): Promise<string> {
  const svgFont = 'sans-serif';
  const synthesis = record.synthesis;
  const title = sanitizeVisualText(record.query || 'Strategy Analysis', 'Strategy Analysis');
  const subtitle = sanitizeVisualText(record.analysis_type.replace(/_/g, ' '), 'Strategic Analysis');
  const summary = sanitizeVisualText(synthesis?.executiveSummary?.trim() || '', 'Strategic analysis completed.');

  const summaryPoints = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => sanitizeVisualText(s, ''))
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => wrapSvgLine(s, 46)[0] || s);

  const actionItems = (synthesis?.strategicRecommendations ?? [])
    .slice(0, 3)
    .map((rec) => sanitizeVisualText(rec.title || rec.description || 'Action', 'Action'))
    .map((s) => wrapSvgLine(s, 34)[0] || s);

  const riskItems = (synthesis?.keyRisks ?? [])
    .slice(0, 2)
    .map((r) => sanitizeVisualText(r, 'Risk'))
    .map((s) => wrapSvgLine(s, 34)[0] || s);

  const questionItems = (synthesis?.openQuestionsForFounders ?? [])
    .slice(0, 2)
    .map((q) => sanitizeVisualText(q, 'Question'))
    .map((s) => wrapSvgLine(s, 34)[0] || s);

  const strengths = synthesis?.unifiedSwot.strengths.length ?? 0;
  const weaknesses = synthesis?.unifiedSwot.weaknesses.length ?? 0;
  const opportunities = synthesis?.unifiedSwot.opportunities.length ?? 0;
  const threats = synthesis?.unifiedSwot.threats.length ?? 0;

  const sources = Math.max(0, record.total_sources ?? 0);
  const searches = Math.max(0, record.total_searches ?? 0);
  const confidence = sanitizeVisualText((record.overall_confidence ?? 'medium').toUpperCase(), 'MEDIUM');

  const maxCount = Math.max(1, strengths, opportunities, threats);
  const barHeight = (count: number): number => Math.max(36, Math.round((count / maxCount) * 120));
  const hStrengths = barHeight(strengths);
  const hOpportunities = barHeight(opportunities);
  const hThreats = barHeight(threats);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864">
  <rect width="1536" height="864" fill="#F6F8FB"/>
  <rect x="0" y="0" width="1536" height="78" fill="#000000"/>

  <text x="56" y="49" fill="#FFFFFF" font-size="24" font-family="${svgFont}" font-weight="700">${escapeSvgText(title)}</text>

  <rect x="40" y="98" rx="14" ry="14" width="470" height="94" fill="#FFFFFF" stroke="#1A1A2E"/>
  <rect x="533" y="98" rx="14" ry="14" width="470" height="94" fill="#FFFFFF" stroke="#1A1A2E"/>
  <rect x="1026" y="98" rx="14" ry="14" width="470" height="94" fill="#FFFFFF" stroke="#1A1A2E"/>
  <text x="66" y="130" fill="#00E0FF" font-size="14" font-family="${svgFont}" font-weight="700">CONFIDENCE</text>
  <text x="66" y="168" fill="#0F172A" font-size="34" font-family="${svgFont}" font-weight="700">${escapeSvgText(confidence)}</text>

  <text x="559" y="130" fill="#00E0FF" font-size="14" font-family="${svgFont}" font-weight="700">RESEARCH COVERAGE</text>
  <text x="559" y="168" fill="#0F172A" font-size="28" font-family="${svgFont}" font-weight="700">${sources} sources / ${searches} searches</text>

  <text x="1052" y="130" fill="#00E0FF" font-size="14" font-family="${svgFont}" font-weight="700">SWOT BALANCE</text>
  <text x="1052" y="168" fill="#0F172A" font-size="28" font-family="${svgFont}" font-weight="700">S${strengths} / W${weaknesses} / O${opportunities} / T${threats}</text>

  <rect x="40" y="214" rx="14" ry="14" width="950" height="310" fill="#FFFFFF" stroke="#1A1A2E"/>
  <text x="66" y="248" fill="#00E0FF" font-size="20" font-family="${svgFont}" font-weight="700">Executive Summary Snapshot</text>

  <rect x="66" y="270" rx="10" ry="10" width="286" height="226" fill="#F8FAFC" stroke="#1A1A2E"/>
  <rect x="372" y="270" rx="10" ry="10" width="286" height="226" fill="#F8FAFC" stroke="#1A1A2E"/>
  <rect x="678" y="270" rx="10" ry="10" width="286" height="226" fill="#F8FAFC" stroke="#1A1A2E"/>

  <text x="84" y="302" fill="#111827" font-size="16" font-family="${svgFont}" font-weight="700">Insight 1</text>
  <text x="84" y="336" fill="#334155" font-size="15" font-family="${svgFont}">${escapeSvgText(summaryPoints[0] ?? 'No summary point available.')}</text>

  <text x="390" y="302" fill="#111827" font-size="16" font-family="${svgFont}" font-weight="700">Insight 2</text>
  <text x="390" y="336" fill="#334155" font-size="15" font-family="${svgFont}">${escapeSvgText(summaryPoints[1] ?? 'No summary point available.')}</text>

  <text x="696" y="302" fill="#111827" font-size="16" font-family="${svgFont}" font-weight="700">Insight 3</text>
  <text x="696" y="336" fill="#334155" font-size="15" font-family="${svgFont}">${escapeSvgText(summaryPoints[2] ?? 'No summary point available.')}</text>

  <rect x="1010" y="214" rx="14" ry="14" width="486" height="150" fill="#FFFFFF" stroke="#1A1A2E"/>
  <text x="1036" y="248" fill="#00E0FF" font-size="20" font-family="${svgFont}" font-weight="700">Priority Actions</text>
  <text x="1036" y="280" fill="#0F172A" font-size="15" font-family="${svgFont}">1) ${escapeSvgText(actionItems[0] ?? 'No action available')}</text>
  <text x="1036" y="310" fill="#0F172A" font-size="15" font-family="${svgFont}">2) ${escapeSvgText(actionItems[1] ?? 'No action available')}</text>
  <text x="1036" y="340" fill="#0F172A" font-size="15" font-family="${svgFont}">3) ${escapeSvgText(actionItems[2] ?? 'No action available')}</text>

  <rect x="1010" y="374" rx="14" ry="14" width="486" height="150" fill="#FFFFFF" stroke="#1A1A2E"/>
  <text x="1036" y="408" fill="#00E0FF" font-size="20" font-family="${svgFont}" font-weight="700">SWOT Trend</text>
  <line x1="1048" y1="500" x2="1460" y2="500" stroke="#CBD5E1"/>
  <rect x="1080" y="${500 - hStrengths}" width="72" height="${hStrengths}" fill="#00E0FF"/>
  <rect x="1190" y="${500 - hOpportunities}" width="72" height="${hOpportunities}" fill="#06B6D4"/>
  <rect x="1300" y="${500 - hThreats}" width="72" height="${hThreats}" fill="#FB7185"/>
  <text x="1080" y="522" fill="#334155" font-size="14" font-family="${svgFont}">Strengths ${strengths}</text>
  <text x="1184" y="522" fill="#334155" font-size="14" font-family="${svgFont}">Opportunities ${opportunities}</text>
  <text x="1326" y="522" fill="#334155" font-size="14" font-family="${svgFont}" text-anchor="middle">Threats ${threats}</text>

  <rect x="40" y="540" rx="14" ry="14" width="728" height="230" fill="#FFFFFF" stroke="#1A1A2E"/>
  <rect x="768" y="540" rx="14" ry="14" width="728" height="230" fill="#FFFFFF" stroke="#1A1A2E"/>
  <text x="66" y="574" fill="#00E0FF" font-size="20" font-family="${svgFont}" font-weight="700">Key Risks</text>
  <text x="66" y="608" fill="#0F172A" font-size="15" font-family="${svgFont}">1) ${escapeSvgText(riskItems[0] ?? 'No key risk recorded')}</text>
  <text x="66" y="638" fill="#0F172A" font-size="15" font-family="${svgFont}">2) ${escapeSvgText(riskItems[1] ?? 'No additional key risk recorded')}</text>

  <text x="794" y="574" fill="#00E0FF" font-size="20" font-family="${svgFont}" font-weight="700">Open Questions</text>
  <text x="794" y="608" fill="#0F172A" font-size="15" font-family="${svgFont}">1) ${escapeSvgText(questionItems[0] ?? 'No open question recorded')}</text>
  <text x="794" y="638" fill="#0F172A" font-size="15" font-family="${svgFont}">2) ${escapeSvgText(questionItems[1] ?? 'No additional open question recorded')}</text>

  <rect x="0" y="834" width="1536" height="30" fill="#000000"/>
  <text x="768" y="854" text-anchor="middle" fill="#FFFFFF" font-size="13" font-family="${svgFont}">Generated by Glyphor Strategy Lab · Data-faithful deterministic infographic</text>
</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.toString('base64');
}

async function requireSdkClient(req: IncomingMessage, res: ServerResponse) {
  const client = await authenticateSdkClient(req.headers.authorization);
  if (!client) {
    json(res, 401, { error: 'Bearer token required' });
    return null;
  }
  return client;
}

async function loadDashboardUserByEmail(email: string): Promise<AuthenticatedDashboardUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await systemQuery<{
    id: string;
    email: string;
    role: 'admin' | 'viewer';
    tenant_id?: string | null;
  }>(
    `SELECT id, email, role, tenant_id
       FROM dashboard_users
      WHERE LOWER(email) = $1
      LIMIT 1`,
    [normalizedEmail],
  );
  const row = rows[0];
  if (!row) {
    if (DASHBOARD_FALLBACK_EMAILS.has(normalizedEmail)) {
      return {
        uid: `fallback:${normalizedEmail}`,
        email: normalizedEmail,
        role: DASHBOARD_FALLBACK_ADMINS.has(normalizedEmail) ? 'admin' : 'viewer',
        tenantId: null,
      };
    }
    return null;
  }
  // Match dashboardApi `isEffectiveDashboardAdmin`: fallback admin emails stay admin even if DB says viewer.
  let role: 'admin' | 'viewer' = row.role === 'admin' ? 'admin' : 'viewer';
  if (role === 'viewer' && DASHBOARD_FALLBACK_ADMINS.has(normalizedEmail)) {
    role = 'admin';
  }
  return {
    uid: row.id,
    email: row.email.trim().toLowerCase(),
    role,
    tenantId: row.tenant_id ?? null,
  };
}

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getRequestOrigin(req: IncomingMessage): string | null {
  const forwardedProto = getHeaderString(req.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderString(req.headers['x-forwarded-host']);
  const host = forwardedHost ?? getHeaderString(req.headers.host);
  if (!host) return null;
  const proto = forwardedProto ?? 'https';
  return `${proto}://${host}`;
}

/** GET endpoints that mirror classifySchedulerRoute "authenticated-user" and must skip the inline admin-only gate. */
function isAdminViewerReadableGet(urlPath: string, method: string): boolean {
  if (method !== 'GET') return false;
  if (/^\/admin\/agents\/[^/]+\/capacity$/.test(urlPath)) return true;
  if (urlPath === '/admin/commitments' || urlPath === '/admin/commitments/pending') return true;
  if (urlPath === '/admin/autonomy' || urlPath === '/admin/autonomy/cohort-benchmarks') return true;
  if (/^\/admin\/autonomy\/[^/]+$/.test(urlPath)) return true;
  return false;
}

function classifySchedulerRoute(pathname: string, method: string): SchedulerRouteClass | null {
  if (pathname === '/health' || pathname === '/') return 'public';
  if (method === 'OPTIONS') return 'public';

  if (pathname === '/run/stream' || pathname === '/run' || pathname === '/ora/chat' || pathname === '/chat/triangulate') {
    return 'authenticated-user';
  }

  if (
    pathname === '/run/events' ||
    pathname === '/run/events/stream'
  ) {
    return 'authenticated-user';
  }

  if (
    pathname === '/api/messages' ||
    pathname === '/api/agent365/activity' ||
    pathname === GRAPH_CHAT_WEBHOOK_PATH ||
    pathname === '/webhook/stripe' ||
    pathname === '/webhook/docusign' ||
    pathname === '/webhook/ci-heal' ||
    pathname === '/oauth/canva/callback' ||
    /^\/directives\/(approve|reject)\/[a-f0-9]+$/.test(pathname)
  ) {
    return 'public';
  }

  if (pathname.startsWith('/admin/metrics')) {
    return method === 'GET' ? 'authenticated-user' : 'admin-only';
  }

  // Authority / commitment registry: read-only GETs for Governance UI — any dashboard login (viewer+).
  // Mutations (PUT capacity, approve/reject commitments) stay admin-only via the broad /admin/ rule below.
  if (
    method === 'GET'
    && (
      /^\/admin\/agents\/[^/]+\/capacity$/.test(pathname)
      || pathname === '/admin/commitments'
      || pathname === '/admin/commitments/pending'
    )
  ) {
    return 'authenticated-user';
  }

  // Autonomy overview: read-only GETs for Governance → Autonomy tab (viewer+). PUT/promote/demote stay admin-only.
  if (
    method === 'GET'
    && (
      pathname === '/admin/autonomy'
      || pathname === '/admin/autonomy/cohort-benchmarks'
      || /^\/admin\/autonomy\/[^/]+$/.test(pathname)
    )
  ) {
    return 'authenticated-user';
  }

  if (
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/eval/') ||
    pathname.startsWith('/api/governance/') ||
    pathname === '/tool-health/run' ||
    pathname === '/tool-health/latest' ||
    pathname === '/gtm-readiness/run' ||
    pathname === '/api/eval/gtm-readiness/latest' ||
    pathname === '/api/eval/gtm-readiness/history' ||
    pathname === '/tools/re-enable'
  ) {
    return 'admin-only';
  }

  // Callable by both cron (OIDC) and dashboard admin
  if (pathname === '/agent-evals/run') {
    return 'admin-or-internal';
  }

  // Golden suite: cron OIDC or any dashboard account (viewer can use "Run golden suite now" in Reliability)
  if (pathname === '/agent-evals/run-golden') {
    return 'internal-or-dashboard-user';
  }

  if (
    pathname === '/pubsub' ||
    pathname === '/event' ||
    pathname === '/heartbeat' ||
    pathname === '/memory/consolidate' ||
    pathname === '/memory/agent-dream' ||
    pathname === '/batch-eval/run' ||
    pathname === '/autonomy/evaluate-daily' ||
    pathname === '/shadow-eval/run' ||
    pathname === '/shadow-eval/run-pending' ||
    pathname === '/world-state/health' ||
    pathname === '/cascade/evaluate' ||
    pathname === '/predictions/resolve' ||
    pathname === '/memory/archive' ||
    pathname === '/canary/evaluate' ||
    pathname === '/planning-gate/monitor' ||
    pathname === '/economics/guardrail-notify' ||
    pathname === '/internal/model-check' ||
    pathname === '/model-check/run' ||
    pathname === '/cache/invalidate' ||
    pathname === '/tools/expire' ||
    pathname.startsWith('/sync/') ||
    pathname.startsWith('/sdk/')
  ) {
    return 'internal-service-only';
  }

  if (
    pathname === '/agents/create' ||
    /^\/agents\/[^/]+\/settings$/.test(pathname) ||
    /^\/agents\/[^/]+\/avatar$/.test(pathname) ||
    /^\/agents\/[^/]+\/prompt$/.test(pathname) ||
    /^\/agents\/[^/]+\/pause$/.test(pathname) ||
    /^\/agents\/[^/]+\/resume$/.test(pathname) ||
    /^\/agents\/[^/]+$/.test(pathname) ||
    pathname === '/analysis/run' ||
    pathname === '/analysis' ||
    /^\/analysis\/[^/]+$/.test(pathname) ||
    /^\/analysis\/[^/]+\/export$/.test(pathname) ||
    /^\/analysis\/[^/]+\/cancel$/.test(pathname) ||
    /^\/analysis\/[^/]+\/enhance$/.test(pathname) ||
    /^\/analysis\/[^/]+\/visual$/.test(pathname) ||
    pathname === '/simulation/run' ||
    pathname === '/simulation' ||
    /^\/simulation\/[^/]+$/.test(pathname) ||
    /^\/simulation\/[^/]+\/accept$/.test(pathname) ||
    /^\/simulation\/[^/]+\/export$/.test(pathname) ||
    pathname === '/meetings/call' ||
    pathname === '/meetings' ||
    /^\/meetings\/[^/]+$/.test(pathname) ||
    pathname === '/cot/run' ||
    pathname === '/cot' ||
    /^\/cot\/[^/]+$/.test(pathname) ||
    /^\/cot\/[^/]+\/export$/.test(pathname) ||
    pathname === '/deep-dive/run' ||
    pathname === '/deep-dive' ||
    /^\/deep-dive\/[^/]+$/.test(pathname) ||
    /^\/deep-dive\/[^/]+\/cancel$/.test(pathname) ||
    /^\/deep-dive\/[^/]+\/export$/.test(pathname) ||
    /^\/deep-dive\/[^/]+\/visual$/.test(pathname) ||
    pathname === '/strategy-lab/run' ||
    pathname === '/strategy-lab' ||
    /^\/strategy-lab\/[^/]+$/.test(pathname) ||
    /^\/strategy-lab\/[^/]+\/cancel$/.test(pathname) ||
    /^\/strategy-lab\/[^/]+\/export$/.test(pathname) ||
    /^\/strategy-lab\/[^/]+\/visual$/.test(pathname) ||
    pathname === '/messages/send' ||
    pathname === '/messages' ||
    /^\/messages\/agent\/[^/]+$/.test(pathname) ||
    pathname === '/pulse' ||
    pathname === '/knowledge/company' ||
    pathname === '/knowledge/routes' ||
    pathname === '/authority/proposals' ||
    /^\/authority\/proposals\/[^/]+\/resolve$/.test(pathname) ||
    pathname === '/knowledge/patterns' ||
    pathname === '/knowledge/contradictions' ||
    pathname === '/directives' ||
    /^\/directives\/[^/]+$/.test(pathname) ||
    pathname === '/quick-assign' ||
    pathname === '/workflows' ||
    pathname === '/workflows/metrics' ||
    /^\/workflows\/[^/]+$/.test(pathname) ||
    /^\/workflows\/[^/]+\/cancel$/.test(pathname) ||
    /^\/workflows\/[^/]+\/retry$/.test(pathname) ||
    /^\/plan-verify\/[^/]+$/.test(pathname) ||
    pathname.startsWith('/api/')
  ) {
    return 'authenticated-user';
  }

  return null;
}

async function resolveRouteAuthContext(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<RouteAuthContext | null> {
  const routeClass = classifySchedulerRoute(pathname, method);
  if (!routeClass) {
    json(
      res,
      403,
      { error: 'Forbidden: route is not classified for access' },
      req,
      authDenyHeaders('route-unclassified'),
    );
    return null;
  }

  if (routeClass === 'public') {
    return { routeClass, dashboardUser: null };
  }

  if (routeClass === 'internal-service-only') {
    const authed = await requireInternalAuth(req, res, pathname);
    if (!authed) return null;
    return { routeClass, dashboardUser: null };
  }

  if (routeClass === 'admin-or-internal') {
    // Accept either a cron OIDC token or a dashboard admin Bearer token.
    const authorization = getHeaderString(req.headers.authorization);
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    // Try OIDC first (cron service account path)
    let isOidc = false;
    if (token) {
      try {
        const requestOrigin = getRequestOrigin(req);
        const audienceCandidates = Array.from(new Set([
          process.env.SCHEDULER_OIDC_AUDIENCE?.trim() || null,
          requestOrigin ? `${requestOrigin}${pathname}` : null,
          requestOrigin,
        ].filter((v): v is string => Boolean(v && v.trim()))));
        for (const audience of audienceCandidates) {
          try {
            await oidcClient.verifyIdToken({ idToken: token, audience });
            isOidc = true;
            break;
          } catch { /* try next audience */ }
        }
      } catch { /* not OIDC */ }
    }
    if (isOidc) return { routeClass, dashboardUser: null };
    // Fall back to dashboard admin check
    const dashboardUser = await requireDashboardUser(req, res, { admin: true });
    if (!dashboardUser) return null;
    return { routeClass, dashboardUser };
  }

  if (routeClass === 'internal-or-dashboard-user') {
    const authorization = getHeaderString(req.headers.authorization);
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    let isOidc = false;
    if (token) {
      try {
        const requestOrigin = getRequestOrigin(req);
        const audienceCandidates = Array.from(
          new Set(
            [
              process.env.SCHEDULER_OIDC_AUDIENCE?.trim() || null,
              requestOrigin ? `${requestOrigin}${pathname}` : null,
              requestOrigin,
            ].filter((v): v is string => Boolean(v && v.trim())),
          ),
        );
        for (const audience of audienceCandidates) {
          try {
            await oidcClient.verifyIdToken({ idToken: token, audience });
            isOidc = true;
            break;
          } catch {
            /* try next audience */
          }
        }
      } catch {
        /* not OIDC */
      }
    }
    if (isOidc) return { routeClass, dashboardUser: null };
    const dashboardUser = await requireDashboardUser(req, res, { admin: false });
    if (!dashboardUser) return null;
    return { routeClass, dashboardUser };
  }

  const dashboardUser = await requireDashboardUser(req, res, { admin: routeClass === 'admin-only' });
  if (!dashboardUser) return null;
  return { routeClass, dashboardUser };
}

function sendSseEvent(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function parseNumericCursor(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function persistDashboardChatMessage(input: {
  agentRole: string;
  role: 'user' | 'agent';
  content: string;
  userId: string;
  conversationId: string;
  sessionId?: string;
  attachments?: Array<{ name: string; mimeType?: string; type?: string }>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await systemQuery(
    `INSERT INTO chat_messages (
       agent_role,
       role,
       content,
       user_id,
       conversation_id,
       session_id,
       attachments,
       metadata,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())`,
    [
      input.agentRole,
      input.role,
      input.content,
      input.userId,
      input.conversationId,
      input.sessionId ?? null,
      input.attachments?.length
        ? JSON.stringify(input.attachments.map((item) => ({ name: item.name, type: item.mimeType ?? item.type ?? 'application/octet-stream' })))
        : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

async function requireDashboardUser(
  req: IncomingMessage,
  res: ServerResponse,
  options?: { admin?: boolean },
): Promise<AuthenticatedDashboardUser | null> {
  if (process.env.NODE_ENV !== 'production') {
    const authHeader = getHeaderString(req.headers.authorization);
    if (!authHeader?.startsWith('Bearer ')) {
      return {
        uid: 'dev-user',
        email: 'dev@localhost',
        role: 'admin',
        tenantId: null,
      };
    }
  }

  const authorization = getHeaderString(req.headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    json(res, 401, { error: 'Bearer token required' }, req, authDenyHeaders('missing-bearer'));
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    json(res, 401, { error: 'Missing bearer token' }, req, authDenyHeaders('empty-bearer'));
    return null;
  }

  try {
    const verified = await verifyUserAccessToken(token);
    const user = await loadDashboardUserByEmail(verified.email);
    if (!user) {
      json(res, 403, { error: 'Forbidden' }, req, authDenyHeaders('dashboard-user-not-found'));
      return null;
    }
    if (options?.admin && user.role !== 'admin') {
      json(res, 403, { error: 'Forbidden' }, req, authDenyHeaders('admin-required'));
      return null;
    }
    return user;
  } catch (err) {
    console.warn('[DashboardAuth] Failed to verify dashboard user token:', err instanceof Error ? err.message : String(err));
    json(res, 401, { error: 'Unauthorized' }, req, authDenyHeaders('token-verification-failed'));
    return null;
  }
}

async function requireInternalAuth(
  req: IncomingMessage,
  res: ServerResponse,
  endpointPath: string,
): Promise<boolean> {
  const authorization = getHeaderString(req.headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    json(res, 401, { ok: false, error: 'Bearer token required' }, req, authDenyHeaders('internal-missing-bearer'));
    return false;
  }

  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) {
    json(res, 401, { ok: false, error: 'Missing bearer token' }, req, authDenyHeaders('internal-empty-bearer'));
    return false;
  }

  const requestOrigin = getRequestOrigin(req);
  const audienceCandidates = Array.from(new Set([
    process.env.SCHEDULER_OIDC_AUDIENCE?.trim() || null,
    requestOrigin ? `${requestOrigin}${endpointPath}` : null,
    requestOrigin,
  ].filter((value): value is string => Boolean(value && value.trim()))));

  if (audienceCandidates.length === 0) {
    console.warn('[InternalAuth] No OIDC audience candidates configured for internal endpoint.');
    json(res, 401, { ok: false, error: 'Unauthorized' }, req, authDenyHeaders('internal-no-audience'));
    return false;
  }

  let verifiedEmail: string | undefined;
  let lastError: unknown = new Error('No audience candidates available');

  for (const audience of audienceCandidates) {
    try {
      const ticket = await oidcClient.verifyIdToken({
        idToken,
        audience,
      });
      const payload = ticket.getPayload();
      verifiedEmail = typeof payload?.email === 'string' ? payload.email : undefined;
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    console.warn('[InternalAuth] Failed OIDC token verification for internal endpoint.');
    json(res, 401, { ok: false, error: 'Unauthorized' }, req, authDenyHeaders('internal-token-verification-failed'));
    return false;
  }

  const expectedServiceAccount = process.env.SCHEDULER_OIDC_SERVICE_ACCOUNT_EMAIL?.trim();
  if (expectedServiceAccount && verifiedEmail && verifiedEmail !== expectedServiceAccount) {
    console.warn(
      `[InternalAuth] OIDC principal mismatch. expected=${expectedServiceAccount} actual=${verifiedEmail}`,
    );
    json(res, 403, { ok: false, error: 'Forbidden' }, req, authDenyHeaders('internal-principal-mismatch'));
    return false;
  }

  return true;
}

function buildChiefOfStaffReactiveMessage(
  task: string,
  payload: Record<string, unknown>,
): string | undefined {
  const providedMessage =
    typeof payload.message === 'string' && payload.message.trim().length > 0
      ? payload.message.trim()
      : undefined;

  if (task === 'process_directive') {
    const context = payload.context && typeof payload.context === 'object'
      ? payload.context as Record<string, unknown>
      : undefined;
    const directiveText = typeof context?.text === 'string' ? context.text.trim() : '';
    const replyChannel = typeof context?.channel === 'string' ? context.channel : 'unknown';
    const replyTs = typeof context?.ts === 'string' ? context.ts : 'none';
    const source = typeof context?.source === 'string' ? context.source : 'unknown';

    const lines = [
      'A customer message arrived via Slack.',
      `Source: ${source}`,
      `Channel: ${replyChannel}`,
      `Thread: ${replyTs}`,
      directiveText ? `Message: "${directiveText}"` : 'Message: (empty)',
      '',
      'Reply in the same Slack thread using post_to_slack and route any actionable marketing work appropriately.',
    ];

    return lines.join('\n');
  }

  if (task !== 'orchestrate') return providedMessage;

  const wakeReason =
    typeof payload.wake_reason === 'string' && payload.wake_reason.trim().length > 0
      ? payload.wake_reason.trim()
      : undefined;
  const eventData =
    payload.event_data && typeof payload.event_data === 'object'
      ? (payload.event_data as Record<string, unknown>)
      : undefined;

  if (!wakeReason && !eventData) return providedMessage;

  const lines: string[] = [];
  if (providedMessage) lines.push(providedMessage);
  if (wakeReason) lines.push(`Reactive wake reason: ${wakeReason}`);

  const scalarFields: Array<[string, string]> = [
    ['initiative_id', 'Initiative ID'],
    ['directive_id', 'Directive ID'],
    ['directive_title', 'Directive'],
    ['deliverable_id', 'Deliverable ID'],
    ['assignment_id', 'Assignment ID'],
    ['completion_summary', 'Completion summary'],
    ['published_deliverable_count', 'Published deliverables'],
    ['handoff_required', 'Handoff required'],
  ];

  for (const [key, label] of scalarFields) {
    const value = eventData?.[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      lines.push(`${label}: ${String(value)}`);
    }
  }

  const publishedDeliverables = Array.isArray(eventData?.published_deliverables)
    ? (eventData?.published_deliverables as Array<Record<string, unknown>>)
    : [];
  if (publishedDeliverables.length > 0) {
    lines.push(
      'Published deliverables:\n' +
        publishedDeliverables
          .map((item) => {
            const title = typeof item.title === 'string' ? item.title : 'Untitled deliverable';
            const type = typeof item.type === 'string' ? item.type : 'unknown';
            const reference =
              typeof item.reference === 'string' && item.reference.trim().length > 0
                ? item.reference.trim()
                : 'No reference recorded';
            return `- ${title} (${type}): ${reference}`;
          })
          .join('\n'),
    );
  }

  const downstreamDirectives = Array.isArray(eventData?.downstream_directives)
    ? (eventData?.downstream_directives as Array<Record<string, unknown>>)
    : [];
  if (downstreamDirectives.length > 0) {
    lines.push(
      'Downstream directives:\n' +
        downstreamDirectives
          .map((item) => {
            const title = typeof item.title === 'string' ? item.title : 'Untitled directive';
            const status = typeof item.status === 'string' ? item.status : 'unknown';
            const id = typeof item.id === 'string' ? ` [${item.id}]` : '';
            return `- ${title}${id} — ${status}`;
          })
          .join('\n'),
    );
  }

  return lines.join('\n');
}

// ─── Bootstrap ──────────────────────────────────────────────────

const memory = new CompanyMemoryStore({
  gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
  gcpProjectId: process.env.GCP_PROJECT_ID,
});

const decisionQueue = new DecisionQueue(memory, {});

function isLiveRuntimeRole(role: string): role is CompanyAgentRole {
  return isCanonicalKeepRole(role);
}

function blockedRuntimeResult(role: string): AgentExecutionResult {
  return {
    output: `Agent "${role}" is not on the live runtime roster and cannot run.`,
    status: 'error',
    totalTurns: 0,
  } as AgentExecutionResult;
}

const agentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  if (!isLiveRuntimeRole(agentRole)) {
    return blockedRuntimeResult(agentRole);
  }

  const message = (payload.message as string) || undefined;
  let conversationHistory = payload.conversationHistory as ConversationTurn[] | undefined;
  const dbRunId = typeof payload.runId === 'string' ? payload.runId : undefined;
  const payloadAssignmentId = typeof payload.assignmentId === 'string' ? payload.assignmentId : undefined;
  const payloadDirectiveId = typeof payload.directiveId === 'string' ? payload.directiveId : undefined;

  // Thread multimodal attachments: inject as a carrier turn at the end of
  // conversationHistory so they reach CompanyAgentRunner without modifying
  // every individual runner's parameter interface.
  const rawAttach = payload.attachments as ConversationAttachment[] | undefined;
  if (dbRunId) {
    if (!conversationHistory) conversationHistory = [];
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: `${DB_RUN_ID_TURN_PREFIX}${dbRunId}`, timestamp: Date.now() },
    ];
  }
  if (rawAttach?.length) {
    if (!conversationHistory) conversationHistory = [];
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: '__multimodal_attachments__', timestamp: Date.now(), attachments: rawAttach },
    ];
  }
  // Inject assignment/directive IDs as carrier turns so they reach baseAgentRunner
  if (payloadAssignmentId) {
    if (!conversationHistory) conversationHistory = [];
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: `${ASSIGNMENT_ID_TURN_PREFIX}${payloadAssignmentId}`, timestamp: Date.now() },
    ];
  }
  if (payloadDirectiveId) {
    if (!conversationHistory) conversationHistory = [];
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: `${DIRECTIVE_ID_TURN_PREFIX}${payloadDirectiveId}`, timestamp: Date.now() },
    ];
  }

  // ─── Universal work_loop / proactive routing ──────────────
  // These tasks are dispatched by the heartbeat work loop for any agent.
  // Ensure the message is set from the payload so each runner's default
  // case picks it up. Keep 'work_loop' as the task so the config ID
  // contains it and the runner applies task-tier limits (6 turns / 120s)
  // instead of on_demand limits (3 / 45s).
  // CMO scheduled work_loop rows use payload.context; handle in cmo branch below (skip generic recursion).
  if (
    (task === 'work_loop' || task === 'proactive') &&
    !message &&
    agentRole !== 'cmo'
  ) {
    if (agentRole === 'vp-design') {
      const enriched = await resolveVpDesignWorkerMessage({
        payload,
        assignmentId: payloadAssignmentId,
        directiveId: payloadDirectiveId,
        conversationHistory,
      });
      if (enriched) {
        return agentExecutor(agentRole, task, { ...payload, message: enriched });
      }
    }
    const effectiveMessage =
      (payload.wake_reason as string) ||
      (typeof payload.context === 'string' ? `Work loop — ${String(payload.context)}` : '') ||
      `Work loop: ${task}`;
    return agentExecutor(agentRole, task, { ...payload, message: effectiveMessage });
  }

  if (agentRole === 'chief-of-staff') {
    const taskMap: Record<string, 'generate_briefing' | 'check_escalations' | 'weekly_review' | 'monthly_retrospective' | 'orchestrate' | 'strategic_planning' | 'midday_digest' | 'process_directive' | 'on_demand'> = {
      morning_briefing: 'generate_briefing',
      check_escalations: 'check_escalations',
      eod_summary: 'generate_briefing',
      midday_digest: 'midday_digest',
      weekly_review: 'weekly_review',
      monthly_retrospective: 'monthly_retrospective',
      orchestrate: 'orchestrate',
      process_directive: 'process_directive',
      // Heartbeat wakes CoS with work_loop/proactive for assignment health checks.
      // Route these through orchestrate mode so decomposition/dispatch behavior
      // is available instead of generic on_demand handling.
      work_loop: 'orchestrate',
      proactive: 'orchestrate',
      strategic_planning: 'strategic_planning',
    };
    const mappedTask = taskMap[task] ?? 'on_demand';
    return runChiefOfStaff({
      task: mappedTask,
      recipient: payload.founder as 'kristina' | 'andrew' | undefined,
      message: buildChiefOfStaffReactiveMessage(mappedTask, payload),
      context: payload.context as Record<string, unknown> | undefined,
      conversationHistory,
    });
  } else if (agentRole === 'cto') {
    return runCTO({
      task: task as CTORunParams['task'],
      message,
      conversationHistory,
    });
  } else if (agentRole === 'cfo') {
    return runCFO({
      task: (task as 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand' | 'urgent_message_response'),
      message,
      conversationHistory,
    });
  } else if (agentRole === 'cpo') {
    return runCPO({ task: (task as 'weekly_usage_analysis' | 'competitive_scan' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cmo') {
    let cmoMessage = message;
    if (!cmoMessage && typeof payload.context === 'string') {
      const ctx = payload.context;
      if (task === 'work_loop') {
        cmoMessage =
          ctx === 'morning_planning'
            ? 'Morning planning (scheduled): review marketing directives, team assignment queue, and set priorities for the day.'
            : ctx === 'midday_review'
              ? 'Midday review (scheduled): check progress on marketing assignments and directives; unblock, evaluate, or escalate as needed.'
              : `Scheduled CMO work_loop (${ctx}). Review directives and team work.`;
      } else if (task === 'process_assignments') {
        cmoMessage =
          'Scheduled: check and execute pending marketing assignments — review work queue, orchestrate team output, flag blockers to Sarah.';
      }
    }
    return runCMO({
      task: task as
        | 'weekly_content_planning'
        | 'generate_content'
        | 'seo_analysis'
        | 'orchestrate'
        | 'content_planning_cycle'
        | 'work_loop'
        | 'process_assignments'
        | 'on_demand',
      message: cmoMessage,
      payload,
      conversationHistory,
    });
  } else if (agentRole === 'vp-design') {
    let vpMsg = message;
    if (!vpMsg?.trim()) {
      const enriched = await resolveVpDesignWorkerMessage({
        message: vpMsg,
        payload,
        assignmentId: payloadAssignmentId,
        directiveId: payloadDirectiveId,
        conversationHistory,
      });
      if (enriched) vpMsg = enriched;
    }
    return runVPDesign({
      task: task as 'design_audit' | 'design_system_review' | 'on_demand',
      message: vpMsg,
      conversationHistory,
    });
  } else if (agentRole === 'ops') {
    return runOps({ task: (task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'contradiction_detection' | 'knowledge_hygiene'), message, eventPayload: payload, conversationHistory });
  } else if (agentRole === 'vp-research') {
    let vpMessage = message;
    if (!vpMessage?.trim() && task === 'urgent_message_response') {
      const ed = payload.event_data as { from_agent?: string; message?: string } | undefined;
      if (ed?.message?.trim()) {
        vpMessage = `URGENT — from ${ed.from_agent ?? 'peer'}:\n${ed.message}`;
      } else {
        vpMessage =
          'URGENT inbound message. Use check_messages to read your queue, fulfill the request (research, web search, competitive work as needed), then reply to the sender with findings.';
      }
    }
    // message.sent events only include message_id; load body so Sophia does not run blind.
    if (!vpMessage?.trim()) {
      const mid = typeof payload.message_id === 'string' ? payload.message_id.trim() : '';
      if (mid) {
        try {
          const [row] = await systemQuery<{ message: string; from_agent: string }>(
            'SELECT message, from_agent FROM agent_messages WHERE id = $1',
            [mid],
          );
          if (row?.message?.trim()) {
            vpMessage = `Inbound message from ${row.from_agent}:\n${row.message}`;
          }
        } catch { /* non-fatal */ }
      }
    }
    return runVPResearch({
      task: task as VPResearchRunParams['task'],
      message: vpMessage,
      analysisId: payload.analysisId as string | undefined,
      query: payload.query as string | undefined,
      analysisType: payload.analysisType as string | undefined,
      depth: payload.depth as string | undefined,
      sarahNotes: payload.sarahNotes as string | undefined,
      rawPackets: payload.rawPackets as Record<string, unknown> | undefined,
      executiveRouting: payload.executiveRouting as Record<string, string[]> | undefined,
      gaps: payload.gaps as unknown[] | undefined,
      conversationHistory,
    });
  } else {
    return blockedRuntimeResult(agentRole);
  }
};

// Wrap executor to record every run in agent_runs for the Activity dashboard
let ensureAgentRunsRoutingSchemaPromise: Promise<void> | null = null;
let verificationPassesColumnType: 'array' | 'integer' | 'unknown' = 'unknown';

type FlagTier = 'info' | 'yellow' | 'red';

interface ParsedRunStatus {
  what: string;
  result: string | null;
  nextAction: string | null;
  flag: string | null;
  flagTier: FlagTier | null;
}

const RUN_STATUS_DEPARTMENT_FALLBACK: Record<string, string> = {
  'chief-of-staff': 'operations',
  cto: 'engineering',
  cfo: 'finance',
  cpo: 'product',
  cmo: 'marketing',
  'vp-customer-success': 'customer-success',
  'vp-sales': 'sales',
  'vp-design': 'design',
  ops: 'operations',
};

const AUTO_INVESTIGATE_ON_FAILURE = process.env.AUTO_INVESTIGATE_ON_FAILURE !== 'false';
const AUTO_RETRY_ON_FAILURE = process.env.AUTO_RETRY_ON_FAILURE === 'true';
const AUTO_RETRY_MAX_ATTEMPTS = Math.max(0, parseInt(process.env.AUTO_RETRY_MAX_ATTEMPTS || '1', 10));

type FounderKey = 'kristina' | 'andrew';

interface DecisionActionExecutePayload {
  type?: string;
  verb?: string;
  data?: {
    decisionId?: string;
    decision_id?: string;
    comment?: string;
  } & Record<string, unknown>;
}

interface DirectiveActionExecutePayload {
  type?: string;
  verb?: string;
  data?: {
    directiveId?: string;
    directive_id?: string;
  } & Record<string, unknown>;
}

let ensureDecisionApprovalsSchemaPromise: Promise<void> | null = null;
let agent365DecisionAppSingleton: AgentApplication<TurnState> | null = null;
let agent365DecisionAdapterSingleton: CloudAdapter | null = null;
let agent365DecisionAuthConfigSingleton: AuthConfiguration | null = null;

function capitalizeFounder(founder: FounderKey): string {
  return founder === 'kristina' ? 'Kristina' : 'Andrew';
}

function normalizeFounderCandidates(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function buildFounderIdentityConfig(): Record<FounderKey, { ids: string[]; emails: string[]; names: string[] }> {
  return {
    kristina: {
      ids: normalizeFounderCandidates([
        process.env.TEAMS_USER_KRISTINA_ID,
      ]),
      emails: normalizeFounderCandidates([
        process.env.TEAMS_USER_KRISTINA_EMAIL,
        'kristina@glyphor.ai',
      ]),
      names: ['kristina denney', 'kristina'],
    },
    andrew: {
      ids: normalizeFounderCandidates([
        process.env.TEAMS_USER_ANDREW_ID,
      ]),
      emails: normalizeFounderCandidates([
        process.env.TEAMS_USER_ANDREW_EMAIL,
        'andrew@glyphor.ai',
        'andrew.zwelling@gmail.com',
      ]),
      names: ['andrew zwelling', 'andrew'],
    },
  };
}

function resolveFounderFromActivity(activity: { from?: Record<string, unknown> | undefined; channelData?: unknown }): FounderKey | null {
  const from = activity.from ?? {};
  const properties = from.properties && typeof from.properties === 'object'
    ? from.properties as Record<string, unknown>
    : {};
  const channelData = activity.channelData && typeof activity.channelData === 'object'
    ? activity.channelData as Record<string, unknown>
    : {};

  const candidates = normalizeFounderCandidates([
    from.id,
    from.name,
    from.aadObjectId,
    properties.email,
    properties.mail,
    properties.upn,
    properties.userPrincipalName,
    channelData.email,
    channelData.mail,
    channelData.upn,
    channelData.userPrincipalName,
  ]);

  const config = buildFounderIdentityConfig();
  for (const founder of ['kristina', 'andrew'] as const) {
    const exactMatches = [...config[founder].ids, ...config[founder].emails];
    if (candidates.some((candidate) => exactMatches.includes(candidate))) {
      return founder;
    }
  }

  for (const founder of ['kristina', 'andrew'] as const) {
    if (candidates.some((candidate) => config[founder].names.some((name) => candidate.includes(name)))) {
      return founder;
    }
  }

  return null;
}

function resolveDecisionFounders(tier: string, assignedTo: string[] | null): FounderKey[] {
  const assigned = (assignedTo ?? []).filter((value): value is FounderKey => value === 'kristina' || value === 'andrew');
  if (tier === 'red') {
    return assigned.length >= 2 ? Array.from(new Set(assigned)) : ['kristina', 'andrew'];
  }
  return assigned.length > 0 ? Array.from(new Set(assigned)) : ['kristina', 'andrew'];
}

async function ensureDecisionApprovalsSchema(): Promise<void> {
  if (!ensureDecisionApprovalsSchemaPromise) {
    ensureDecisionApprovalsSchemaPromise = (async () => {
      const safeSchemaChange = async (sql: string) => {
        try {
          await systemQuery(sql);
        } catch (err) {
          console.warn('[Scheduler] Decision approval schema change skipped:', (err as Error).message);
        }
      };

      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS decision_approvals (
          decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
          founder TEXT NOT NULL,
          approved BOOLEAN NOT NULL,
          comment TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (decision_id, founder)
        )
      `);
      await safeSchemaChange('CREATE INDEX IF NOT EXISTS idx_decision_approvals_decision ON decision_approvals(decision_id, created_at DESC)');
    })().catch((err) => {
      ensureDecisionApprovalsSchemaPromise = null;
      throw err;
    });
  }

  await ensureDecisionApprovalsSchemaPromise;
}

function buildAgent365DecisionAuthConfig(): AuthConfiguration | null {
  if (agent365DecisionAuthConfigSingleton) return agent365DecisionAuthConfigSingleton;

  const clientId = process.env.AGENT365_CLIENT_ID?.trim();
  const clientSecret = process.env.AGENT365_CLIENT_SECRET?.trim();
  const tenantId = process.env.AGENT365_TENANT_ID?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  // Multi-tenant bot: when AGENT365_TENANT_ID is blank or "common",
  // the bot accepts activities from any Entra tenant (required for
  // customer Teams workspace installs). Single-tenant when set to a
  // specific tenant GUID.
  const resolvedTenantId = tenantId && tenantId !== 'common' ? tenantId : 'common';

  const serviceConnection: AuthConfiguration = {
    clientId,
    clientSecret,
    tenantId: resolvedTenantId,
    authority: 'https://login.microsoftonline.com',
    connectionName: 'serviceConnection',
  };

  agent365DecisionAuthConfigSingleton = {
    ...serviceConnection,
    connections: new Map([['serviceConnection', serviceConnection]]),
    connectionsMap: [{ serviceUrl: '*', connection: 'serviceConnection' }],
  };

  return agent365DecisionAuthConfigSingleton;
}

async function finalizeDecisionFromTeams(
  decisionId: string,
  status: 'approved' | 'rejected',
  resolvedBy: string,
  resolutionNote: string,
): Promise<void> {
  const [resolved] = await systemQuery<{
    id: string;
    tier: string;
    title: string;
    summary: string;
    proposed_by: string;
    reasoning: string;
    assigned_to: string[] | null;
  }>(
    `UPDATE decisions
        SET status = $2,
            resolved_by = $3,
            resolution_note = $4,
            resolved_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, tier, title, summary, proposed_by, reasoning, assigned_to`,
    [decisionId, status, resolvedBy, resolutionNote],
  );

  if (!resolved) return;

  await memory.write(`decision.resolved.${decisionId}`, {
    id: resolved.id,
    tier: resolved.tier,
    title: resolved.title,
    summary: resolved.summary,
    proposedBy: resolved.proposed_by,
    reasoning: resolved.reasoning,
    assignedTo: resolved.assigned_to ?? [],
    status,
    resolvedBy,
    resolutionNote,
    resolvedAt: new Date().toISOString(),
  }, 'scheduler');

  await memory.write(`activity.decision.${decisionId}`, {
    type: 'decision_resolved',
    decisionId,
    status,
    agentRole: resolved.proposed_by,
    title: resolved.title,
    by: resolvedBy,
    at: new Date().toISOString(),
  }, 'scheduler');
}

async function handleAgent365DecisionAction(
  activity: { from?: Record<string, unknown> | undefined; channelData?: unknown },
  action: DecisionActionExecutePayload,
  approved: boolean,
): Promise<string> {
  await ensureDecisionApprovalsSchema();

  const decisionId = typeof action.data?.decisionId === 'string'
    ? action.data.decisionId.trim()
    : typeof action.data?.decision_id === 'string'
      ? action.data.decision_id.trim()
      : '';

  if (!decisionId) {
    return 'Decision action is missing a decision ID.';
  }

  const founder = resolveFounderFromActivity(activity);
  if (!founder) {
    return 'Only founders can approve or reject decisions in Teams.';
  }

  const [decision] = await systemQuery<{
    id: string;
    tier: string;
    status: string;
    title: string;
    assigned_to: string[] | null;
    proposed_by: string;
    summary: string;
    data: Record<string, unknown> | null;
  }>(
    'SELECT id, tier, status, title, assigned_to, proposed_by, summary, data FROM decisions WHERE id = $1 LIMIT 1',
    [decisionId],
  );

  if (!decision) {
    return `Decision ${decisionId} was not found.`;
  }

  if (decision.status !== 'pending') {
    return `Decision "${decision.title}" is already ${decision.status}.`;
  }

  const decisionData = decision.data && typeof decision.data === 'object'
    ? decision.data as Record<string, unknown>
    : {};
  const decisionType = typeof decisionData.type === 'string' ? decisionData.type : null;
  const decisionRequester = typeof decisionData.requested_by === 'string'
    ? decisionData.requested_by
    : decision.proposed_by;

  if (decisionType === 'new_specialist_agent') {
    const requestedAgentName = typeof decisionData.proposed_agent_name === 'string'
      ? decisionData.proposed_agent_name
      : decision.title.replace(/^New specialist agent:\s*/i, '').trim() || 'unknown-agent';
    const context = typeof decisionData.justification === 'string'
      ? decisionData.justification
      : decision.summary;

    await handleIllegalAgentCreationRequest(decisionRequester, requestedAgentName, context);
    await finalizeDecisionFromTeams(
      decisionId,
      'rejected',
      'system:auto-policy',
      'Auto-rejected policy violation: new specialist agent requests are not allowed.',
    );
    return `Decision "${decision.title}" was auto-rejected and logged as a policy violation.`;
  }

  if (decisionType === 'restricted_tool_request') {
    const toolName = typeof decisionData.tool_name === 'string' ? decisionData.tool_name.trim() : '';
    if (toolName) {
      const [toolExistsRow] = await systemQuery<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM tool_registry WHERE name = $1 AND is_active = true) AS exists',
        [toolName],
      );
      if (!toolExistsRow?.exists) {
        await handleMisroutedToolGap(decisionRequester, toolName);
        await finalizeDecisionFromTeams(
          decisionId,
          'rejected',
          'system:auto-route',
          `Auto-routed tool gap "${toolName}" to Nexus; founder approval rejected by policy.`,
        );
        return `Decision "${decision.title}" was auto-routed to Nexus and rejected from founder queue.`;
      }
    }
  }

  const requiredFounders = resolveDecisionFounders(decision.tier, decision.assigned_to);
  if (!requiredFounders.includes(founder)) {
    return `Decision "${decision.title}" is not assigned to ${capitalizeFounder(founder)}.`;
  }

  const notePrefix = approved ? 'Approved' : 'Rejected';
  await systemQuery(
    `INSERT INTO decision_approvals (decision_id, founder, approved, comment, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (decision_id, founder)
     DO UPDATE SET approved = EXCLUDED.approved, comment = EXCLUDED.comment, created_at = NOW()`,
    [decisionId, founder, approved, typeof action.data?.comment === 'string' ? action.data.comment : null],
  );

  if (decision.tier === 'red') {
    const approvalRows = await systemQuery<{ founder: string; approved: boolean }>(
      'SELECT founder, approved FROM decision_approvals WHERE decision_id = $1',
      [decisionId],
    );

    const approvals = new Map<FounderKey, boolean>();
    for (const row of approvalRows) {
      if (row.founder === 'kristina' || row.founder === 'andrew') {
        approvals.set(row.founder, row.approved);
      }
    }

    const allResponded = requiredFounders.every((item) => approvals.has(item));
    if (!allResponded) {
      const waitingOn = requiredFounders
        .filter((item) => !approvals.has(item))
        .map(capitalizeFounder);
      return `${notePrefix} recorded for "${decision.title}" by ${capitalizeFounder(founder)}. Waiting on ${waitingOn.join(' and ')}.`;
    }

    const finalApproved = requiredFounders.every((item) => approvals.get(item) === true);
    const finalStatus = finalApproved ? 'approved' : 'rejected';
    const resolvedBy = requiredFounders.join(',');

    if (!finalApproved) {
      await handleFounderRejection({
        approvalId: decision.id,
        rejectedBy: founder,
        originatingAgent: decision.proposed_by,
        rootCauseAgent:
          typeof decisionData.root_cause_agent === 'string'
            ? decisionData.root_cause_agent
            : decision.proposed_by,
        reason:
          typeof action.data?.comment === 'string' && action.data.comment.trim().length > 0
            ? action.data.comment.trim()
            : decision.title,
        taskType: decisionType ?? decision.title,
      });
    }

    await finalizeDecisionFromTeams(
      decisionId,
      finalStatus,
      resolvedBy,
      `${finalApproved ? 'Approved' : 'Rejected'} in Teams via Agent365 after responses from ${requiredFounders.map(capitalizeFounder).join(' and ')}.`,
    );
    return finalApproved
      ? `Decision "${decision.title}" approved.`
      : `Decision "${decision.title}" rejected.`;
  }

  const finalStatus = approved ? 'approved' : 'rejected';

  if (!approved) {
    await handleFounderRejection({
      approvalId: decision.id,
      rejectedBy: founder,
      originatingAgent: decision.proposed_by,
      rootCauseAgent:
        typeof decisionData.root_cause_agent === 'string'
          ? decisionData.root_cause_agent
          : decision.proposed_by,
      reason:
        typeof action.data?.comment === 'string' && action.data.comment.trim().length > 0
          ? action.data.comment.trim()
          : decision.title,
      taskType: decisionType ?? decision.title,
    });
  }

  await finalizeDecisionFromTeams(
    decisionId,
    finalStatus,
    founder,
    `${notePrefix} in Teams via Agent365 by ${capitalizeFounder(founder)}.`,
  );
  return approved
    ? `Decision "${decision.title}" approved by ${capitalizeFounder(founder)}.`
    : `Decision "${decision.title}" rejected by ${capitalizeFounder(founder)}.`;
}

async function handleDirectiveActionExecute(
  activity: { from?: Record<string, unknown> | undefined; channelData?: unknown },
  action: DirectiveActionExecutePayload,
  approved: boolean,
): Promise<string> {
  const directiveId = typeof action.data?.directiveId === 'string'
    ? action.data.directiveId.trim()
    : typeof action.data?.directive_id === 'string'
      ? action.data.directive_id.trim()
      : '';

  if (!directiveId) {
    return 'Directive action is missing a directive ID.';
  }

  const founder = resolveFounderFromActivity(activity);
  if (!founder) {
    return 'Only founders can approve or reject directives.';
  }

  const [directive] = await systemQuery<{
    id: string;
    title: string;
    status: string;
    priority: string;
    target_agents: string[];
  }>(
    'SELECT id, title, status, priority, target_agents FROM founder_directives WHERE id = $1 LIMIT 1',
    [directiveId],
  );

  if (!directive) {
    return `Directive ${directiveId} was not found.`;
  }

  if (directive.status !== 'proposed') {
    return `Directive "${directive.title}" is already ${directive.status}.`;
  }

  const newStatus = approved ? 'active' : 'rejected';

  await systemQuery(
    `UPDATE founder_directives SET status = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, directive.id],
  );

  // Burn any outstanding URL-based approval tokens for this directive
  await systemQuery(
    `UPDATE directive_approval_tokens SET used_at = NOW() WHERE directive_id = $1 AND used_at IS NULL`,
    [directive.id],
  ).catch(() => {});

  await systemQuery(
    `INSERT INTO activity_log (agent_role, action, summary)
     VALUES ('system', $1, $2)`,
    [
      approved ? 'directive_approved' : 'directive_rejected',
      `Directive "${directive.title}" ${newStatus} by ${capitalizeFounder(founder)} via Teams button`,
    ],
  );

  return approved
    ? `✓ Directive "${directive.title}" approved by ${capitalizeFounder(founder)}. Now active.`
    : `✕ Directive "${directive.title}" rejected by ${capitalizeFounder(founder)}.`;
}

// ─── Customer Teams onboarding (conversationUpdate handler) ─────────────

async function handleTeamsInstallEvent(context: TurnContext): Promise<void> {
  const activity = context.activity as Record<string, unknown>;
  const conversation = activity.conversation as { tenantId?: string; id?: string } | undefined;
  const teamsTenantId = conversation?.tenantId;
  const conversationId = conversation?.id;
  const serviceUrl = activity.serviceUrl as string | undefined;
  const recipient = activity.recipient as { id?: string } | undefined;
  const botId = recipient?.id;

  // Only act when the *bot* was added (not when a human joins a channel)
  const membersAdded = (activity.membersAdded ?? []) as Array<{ id?: string; aadObjectId?: string }>;
  const botWasAdded = membersAdded.some((m) => m.id === botId);
  if (!botWasAdded) return;

  if (!teamsTenantId) {
    console.warn('[Teams Onboarding] conversationUpdate missing tenantId — skipping');
    return;
  }

  const installerAadId = membersAdded.find((m) => m.id !== botId)?.aadObjectId ?? null;

  // Extract teamId from channelData if available (Teams group conversations)
  const channelData = activity.channelData as { team?: { id?: string }; tenant?: { id?: string } } | undefined;
  const teamsTeamId = channelData?.team?.id ?? null;
  const workspaceKey = canonicalTeamsWorkspaceKey(teamsTenantId, teamsTeamId);
  const verifiedBinding = await resolveVerifiedTeamsTenantBinding(teamsTenantId, teamsTeamId);
  const bindingStatus = verifiedBinding ? 'verified' : 'pending';
  const proof = buildTeamsInstallProof({
    teamsTenantId,
    teamsTeamId,
    installerAadId,
    serviceUrl,
    conversationId,
    source: 'conversation_update',
  });

  console.log(`[Teams Onboarding] Bot installed: tenant=${teamsTenantId} team=${teamsTeamId ?? 'personal'} installer=${installerAadId ?? 'unknown'}`);

  // Upsert customer_tenants row
  const rows = await systemQuery<{ id: string; settings: Record<string, unknown>; teams_binding_status: string | null }>(
    `INSERT INTO customer_tenants
       (tenant_id, teams_tenant_id, teams_team_id, teams_installer_aad_id,
        teams_service_url, teams_conversation_id, teams_binding_status,
        teams_binding_verified_at, teams_binding_workspace_key, teams_binding_proof,
        platform, status, installed_by)
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $7 = 'verified' THEN NOW() ELSE NULL END,
        $8, $9::jsonb, 'teams', 'active', 'teams_install'
      )
      ON CONFLICT (teams_tenant_id, teams_team_id)
        WHERE teams_tenant_id IS NOT NULL
      DO UPDATE
        SET tenant_id               = CASE
                                        WHEN EXCLUDED.teams_binding_status = 'verified'
                                          THEN EXCLUDED.tenant_id
                                        ELSE customer_tenants.tenant_id
                                      END,
            teams_installer_aad_id = COALESCE(EXCLUDED.teams_installer_aad_id, customer_tenants.teams_installer_aad_id),
            teams_service_url      = COALESCE(EXCLUDED.teams_service_url, customer_tenants.teams_service_url),
            teams_conversation_id  = COALESCE(EXCLUDED.teams_conversation_id, customer_tenants.teams_conversation_id),
            teams_binding_status   = CASE
                                        WHEN EXCLUDED.teams_binding_status = 'verified'
                                          THEN 'verified'
                                        ELSE COALESCE(customer_tenants.teams_binding_status, EXCLUDED.teams_binding_status)
                                      END,
            teams_binding_verified_at = CASE
                                          WHEN EXCLUDED.teams_binding_status = 'verified'
                                            THEN COALESCE(customer_tenants.teams_binding_verified_at, NOW())
                                          ELSE customer_tenants.teams_binding_verified_at
                                        END,
            teams_binding_workspace_key = COALESCE(EXCLUDED.teams_binding_workspace_key, customer_tenants.teams_binding_workspace_key),
            teams_binding_proof    = COALESCE(customer_tenants.teams_binding_proof, '{}'::jsonb) || EXCLUDED.teams_binding_proof,
            status                 = 'active',
            updated_at             = NOW()
      RETURNING id, settings, teams_binding_status`,
    [
      verifiedBinding?.tenantId ?? DEFAULT_SYSTEM_TENANT_ID,
      teamsTenantId,
      teamsTeamId,
      installerAadId,
      serviceUrl,
      conversationId,
      bindingStatus,
      verifiedBinding?.workspaceKey ?? workspaceKey,
      JSON.stringify(proof),
    ],
  );

  const customerTenant = rows[0];
  if (!customerTenant) {
    console.error('[Teams Onboarding] Failed to upsert customer_tenants row');
    return;
  }

  // If onboarding is already complete, send a welcome-back message
  if (customerTenant.settings?.['onboarding_complete']) {
    await context.sendActivity(
      customerTenant.teams_binding_status === 'verified'
        ? 'Welcome back! Glyphor is reconnected to this workspace.'
        : 'Glyphor is reconnected to this Teams workspace, but tenant verification is still pending. Customer-facing Teams delivery stays disabled until the workspace is linked in Glyphor.',
    );
    return;
  }

  // Start the onboarding questionnaire
  await context.sendActivity(
    (customerTenant.teams_binding_status === 'verified'
      ? "Hi \u2014 I'm Maya, your CMO. Before I get started, I have a few quick questions "
      : "Hi \u2014 I'm Maya, your CMO. I recorded this Teams install, but tenant verification is still pending. "
        + 'Customer-facing Teams delivery will stay disabled until this workspace is linked in Glyphor.\n\n'
        + 'I can still capture onboarding details while that binding is completed.\n\n'
        + 'Before I get started, I have a few quick questions ') +
    'so I can tailor everything to your business.\n\n' +
    "What's your product or service? Give me 2-3 sentences.",
  );

  // Store onboarding state
  await systemQuery(
    `UPDATE customer_tenants
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      customerTenant.id,
      JSON.stringify({
        onboarding_step: 0,
        onboarding_conversation_id: conversationId,
        onboarding_answers: {},
      }),
    ],
  );

  console.log(`[Teams Onboarding] Started for customer_tenant=${customerTenant.id}`);
}

// ─── Customer approval handler (Action.Execute from Adaptive Cards) ──────────

async function handleCustomerApprovalAction(
  approvalId: string,
  status: 'approved' | 'rejected',
): Promise<string> {
  if (!approvalId) return 'Missing approval_id';

  const rows = await systemQuery<{ id: string; status: string; payload: Record<string, unknown> }>(
    `UPDATE slack_approvals
        SET status = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, status, payload`,
    [approvalId, status],
  );

  const row = rows[0];
  if (!row) return `Approval ${approvalId} was already resolved or not found.`;

  const summary = (row.payload?.summary as string) ?? '';
  const agentRole = (row.payload?.agent_role as string) ?? 'unknown';
  const emoji = status === 'approved' ? '✓' : '✕';

  console.log(`[Customer Approval] ${approvalId} → ${status} (agent=${agentRole})`);
  return `${emoji} ${agentRole} deliverable "${summary.slice(0, 60)}" ${status}.`;
}

function getAgent365DecisionApp(): { adapter: CloudAdapter; app: AgentApplication<TurnState> } | null {
  if (agent365DecisionAppSingleton && agent365DecisionAdapterSingleton) {
    return { adapter: agent365DecisionAdapterSingleton, app: agent365DecisionAppSingleton };
  }

  const authConfig = buildAgent365DecisionAuthConfig();
  if (!authConfig) {
    return null;
  }

  const adapter = new CloudAdapter(authConfig);
  const app = new AgentApplication<TurnState>({
    adapter,
    agentAppId: authConfig.clientId,
    storage: MemoryStorage.getSingleInstance(),
  });

  app.adaptiveCards.actionExecute<DecisionActionExecutePayload>('decision.approve', async (context, _state, action) => {
    return await handleAgent365DecisionAction(context.activity as Record<string, unknown>, action, true);
  });

  app.adaptiveCards.actionExecute<DecisionActionExecutePayload>('decision.reject', async (context, _state, action) => {
    return await handleAgent365DecisionAction(context.activity as Record<string, unknown>, action, false);
  });

  app.adaptiveCards.actionExecute<DirectiveActionExecutePayload>('directive.approve', async (context, _state, action) => {
    return await handleDirectiveActionExecute(context.activity as Record<string, unknown>, action, true);
  });

  app.adaptiveCards.actionExecute<DirectiveActionExecutePayload>('directive.reject', async (context, _state, action) => {
    return await handleDirectiveActionExecute(context.activity as Record<string, unknown>, action, false);
  });

  // ── Customer onboarding: handle Teams app install (conversationUpdate) ──
  app.onConversationUpdate('membersAdded', async (context, _state) => {
    await handleTeamsInstallEvent(context);
  });

  // ── Customer-facing approval card buttons ──
  app.adaptiveCards.actionExecute<{ data?: { approval_id?: string; action?: string } }>(
    'customer_approval.approve',
    async (_context, _state, action) => {
      return await handleCustomerApprovalAction(action.data?.approval_id ?? '', 'approved');
    },
  );
  app.adaptiveCards.actionExecute<{ data?: { approval_id?: string; action?: string } }>(
    'customer_approval.reject',
    async (_context, _state, action) => {
      return await handleCustomerApprovalAction(action.data?.approval_id ?? '', 'rejected');
    },
  );

  agent365DecisionAdapterSingleton = adapter;
  agent365DecisionAppSingleton = app;
  return { adapter, app };
}

class NodeResponseShim {
  private statusCode = 200;

  constructor(private readonly res: ServerResponse) {}

  status(code: number): this {
    this.statusCode = code;
    this.res.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.res.setHeader(name, value);
    return this;
  }

  send(body?: unknown): this {
    if (body === undefined) return this;

    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      this.res.write(body);
      return this;
    }

    if (!this.res.hasHeader('content-type')) {
      this.res.setHeader('content-type', 'application/json');
    }
    this.res.write(JSON.stringify(body));
    return this;
  }

  end(): this {
    if (!this.res.writableEnded) {
      this.res.statusCode = this.statusCode;
      this.res.end();
    }
    return this;
  }
}

async function handleAgent365ActivityRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const configured = getAgent365DecisionApp();
  if (!configured) {
    json(res, 503, { error: 'Agent365 activity handling is not configured' });
    return true;
  }

  const bodyText = methodSupportsBody(req.method) ? await readBody(req).catch(() => '{}') : '{}';
  const body = bodyText.trim().length > 0 ? JSON.parse(bodyText) as Record<string, unknown> : {};
  const reqShim: AgentHostingRequest = {
    body,
    headers: req.headers,
    method: req.method,
  };
  const resShim = new NodeResponseShim(res);
  const authMiddleware = authorizeJWT(buildAgent365DecisionAuthConfig()!);

  let nextCalled = false;
  await authMiddleware(reqShim, resShim as never, () => {
    nextCalled = true;
  });

  if (!nextCalled) {
    resShim.end();
    return true;
  }

  await configured.adapter.process(
    reqShim,
    resShim as never,
    async (context) => {
      await configured.app.run(context);
    },
  );

  return true;
}

function methodSupportsBody(method: string | undefined): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

async function ensureAgentRunsRoutingSchema(): Promise<void> {
  if (!ensureAgentRunsRoutingSchemaPromise) {
    ensureAgentRunsRoutingSchemaPromise = (async () => {
      const safeSchemaChange = async (sql: string) => {
        try {
          await systemQuery(sql);
        } catch (err) {
          console.warn('[Scheduler] Schema change skipped:', (err as Error).message);
        }
      };

      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_rule TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_capabilities TEXT[]');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_model TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_routing_reason TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS subtask_complexity TEXT');
      await safeSchemaChange("ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'internal'");
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS client_id UUID');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS verification_tier TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS verification_reason TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS verification_passes TEXT[]');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS actual_model TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS actual_provider TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_cost_usd DOUBLE PRECISION');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS compaction_count INT DEFAULT 0');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS result_summary TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS plan_manifest JSONB');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS context_manifest JSONB');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS fast_path_reason TEXT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS mutating_tool_calls INT');
      await safeSchemaChange('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS completion_gate_passed BOOLEAN');
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS agent_run_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          event_seq BIGINT NOT NULL,
          event_uid TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          trigger TEXT,
          component TEXT NOT NULL,
          trace_id TEXT,
          parent_event_uid TEXT,
          approval_state TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          payload_digest TEXT NOT NULL,
          prev_event_digest TEXT,
          event_digest TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (run_id, event_seq)
        )
      `);
      await safeSchemaChange('CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_seq ON agent_run_events(run_id, event_seq ASC)');
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS agent_run_evidence (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          evidence_uid TEXT NOT NULL UNIQUE,
          source_type TEXT NOT NULL,
          source_tool TEXT,
          source_ref TEXT,
          content_digest TEXT NOT NULL,
          content_preview TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS agent_claim_evidence_links (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          claim_uid TEXT NOT NULL,
          claim_text TEXT NOT NULL,
          evidence_uid TEXT NOT NULL REFERENCES agent_run_evidence(evidence_uid) ON DELETE CASCADE,
          verification_state TEXT NOT NULL DEFAULT 'supported',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (claim_uid, evidence_uid)
        )
      `);
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS agent_failure_taxonomy (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          agent_role TEXT NOT NULL,
          task_class TEXT NOT NULL,
          failure_code TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          detail TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS decision_approvals (
          decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
          founder TEXT NOT NULL,
          approved BOOLEAN NOT NULL,
          comment TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (decision_id, founder)
        )
      `);
      await safeSchemaChange('CREATE INDEX IF NOT EXISTS idx_decision_approvals_decision ON decision_approvals(decision_id, created_at DESC)');
      await safeSchemaChange(`
        CREATE TABLE IF NOT EXISTS agent_run_status (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_role TEXT NOT NULL,
          department TEXT NOT NULL,
          run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
          what TEXT NOT NULL,
          result TEXT,
          next_action TEXT,
          flag TEXT,
          flag_tier TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT agent_run_status_flag_tier_check
            CHECK (flag_tier IS NULL OR flag_tier IN ('info', 'yellow', 'red'))
        )
      `);
      await safeSchemaChange('CREATE INDEX IF NOT EXISTS idx_agent_run_status_dept ON agent_run_status(department, created_at DESC)');
      await safeSchemaChange('CREATE INDEX IF NOT EXISTS idx_agent_run_status_flags ON agent_run_status(flag_tier, created_at DESC) WHERE flag IS NOT NULL');
      await safeSchemaChange('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS compacted BOOLEAN DEFAULT FALSE');

      // Migration drift guard for Phase 3 + Phase 7 columns used by smoketests.
      await safeSchemaChange("ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS knowledge_access_scope TEXT[] NOT NULL DEFAULT ARRAY['general']");
      await safeSchemaChange('ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)');
      await safeSchemaChange("ALTER TABLE company_agents ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000'");
      await safeSchemaChange("UPDATE company_agents SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL");
      await safeSchemaChange('ALTER TABLE company_agents ALTER COLUMN tenant_id SET NOT NULL');
      await safeSchemaChange("ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT 'internal'");
      await safeSchemaChange('ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS created_by_client_id UUID REFERENCES a2a_clients(id)');
      await safeSchemaChange("ALTER TABLE company_agents ADD COLUMN IF NOT EXISTS authority_scope TEXT DEFAULT 'green'");
      await safeSchemaChange('ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)');
      await safeSchemaChange("ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000'");
      await safeSchemaChange("UPDATE agent_profiles SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL");
      await safeSchemaChange('ALTER TABLE agent_profiles ALTER COLUMN tenant_id SET NOT NULL');

      // Legacy schema guard: some environments created verification_passes as int4.
      // Convert in place so verification pass arrays can be persisted safely.
      const [verificationPassesType] = await systemQuery<{ udt_name: string }>(
        `SELECT udt_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'agent_runs'
            AND column_name = 'verification_passes'
          LIMIT 1`,
      );
      if (verificationPassesType?.udt_name === 'int4') {
        await safeSchemaChange(
          `ALTER TABLE agent_runs
             ALTER COLUMN verification_passes TYPE TEXT[]
             USING CASE
               WHEN verification_passes IS NULL THEN NULL
               ELSE ARRAY[verification_passes::text]
             END`,
        );
      }

      const [effectiveVerificationPassesType] = await systemQuery<{ udt_name: string }>(
        `SELECT udt_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'agent_runs'
            AND column_name = 'verification_passes'
          LIMIT 1`,
      ).catch(() => []);
      verificationPassesColumnType = effectiveVerificationPassesType?.udt_name === '_text'
        ? 'array'
        : 'integer'; // Default to integer (safe: .passes.length always works)

      await safeSchemaChange('ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check');
      await safeSchemaChange(
        `ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
          CHECK (status IN ('running', 'completed', 'failed', 'aborted', 'skipped_precheck'))`,
      );
    })().catch((err) => {
      ensureAgentRunsRoutingSchemaPromise = null;
      throw err;
    });
  }
  await ensureAgentRunsRoutingSchemaPromise;
}

function deriveFlagTier(flag: string): FlagTier {
  const normalized = flag.toLowerCase();
  if (normalized.includes('red') || normalized.includes('critical') || normalized.includes('outage') || normalized.includes('sev-1')) {
    return 'red';
  }
  if (normalized.includes('yellow') || normalized.includes('risk') || normalized.includes('blocked') || normalized.includes('at risk') || normalized.includes('deadline')) {
    return 'yellow';
  }
  return 'info';
}

function parseStructuredRunStatus(rawText: string, fallbackWhat: string, fallbackFlag?: string | null): ParsedRunStatus {
  const sections: Record<'what' | 'result' | 'next' | 'flag', string[]> = {
    what: [],
    result: [],
    next: [],
    flag: [],
  };

  const lines = rawText.split(/\r?\n/);
  let current: keyof typeof sections | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^[-*]?\s*(WHAT(?:\s+YOU\s+DID)?|RESULT|NEXT(?:\s*ACTION)?|FLAG)\s*[:\-]\s*(.*)$/i);
    if (match) {
      const label = match[1].toLowerCase();
      if (label.startsWith('what')) current = 'what';
      else if (label.startsWith('result')) current = 'result';
      else if (label.startsWith('next')) current = 'next';
      else current = 'flag';

      if (match[2]) {
        sections[current].push(match[2].trim());
      }
      continue;
    }

    if (current) {
      sections[current].push(line);
    }
  }

  const compact = (parts: string[]) => {
    const merged = parts.join(' ').replace(/\s+/g, ' ').trim();
    return merged.length > 0 ? merged : null;
  };

  const what = compact(sections.what)
    ?? rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0]
    ?? fallbackWhat;
  const result = compact(sections.result);
  const nextAction = compact(sections.next);
  const parsedFlag = compact(sections.flag) ?? (fallbackFlag ?? null);

  return {
    what,
    result,
    nextAction,
    flag: parsedFlag,
    flagTier: parsedFlag ? deriveFlagTier(parsedFlag) : null,
  };
}

async function storeAgentRunStatus(
  agentRole: CompanyAgentRole,
  task: string,
  runId: string,
  runStatus: string,
  result?: AgentExecutionResult,
  fallbackError?: string,
): Promise<void> {
  try {
    const [meta] = await systemQuery<{ department: string | null }>(
      'SELECT department FROM company_agents WHERE role = $1 LIMIT 1',
      [agentRole],
    );
    const department = meta?.department ?? RUN_STATUS_DEPARTMENT_FALLBACK[agentRole] ?? 'operations';

    const summary = (result?.resultSummary ?? '').trim();
    const output = (result?.output ?? '').trim();
    const error = runStatus === 'skipped_precheck'
      ? null
      : (fallbackError ?? result?.error ?? result?.abortReason ?? null);
    const fallbackWhat = `${agentRole} ran ${task} (${runStatus})`;
    const source = [summary, output].filter(Boolean).join('\n');
    const parsed = parseStructuredRunStatus(source, fallbackWhat, error);

    const what = parsed.what.slice(0, 500);
    const resultText = parsed.result?.slice(0, 4000) ?? null;
    const nextAction = parsed.nextAction?.slice(0, 1000) ?? null;
    const flag = parsed.flag?.slice(0, 2000) ?? null;

    await systemQuery(
      `INSERT INTO agent_run_status (agent_role, department, run_id, what, result, next_action, flag, flag_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [agentRole, department, runId, what, resultText, nextAction, flag, parsed.flagTier],
    );
  } catch (err) {
    console.warn('[Scheduler] Failed to persist agent_run_status:', (err as Error).message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reconcileReflectionRunIds(agentRunId: string, runnerRunId: string): Promise<void> {
  if (!UUID_RE.test(agentRunId) || !runnerRunId || runnerRunId === agentRunId) return;

  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const [row] = await systemQuery<{ updated: number }>(
        `WITH patched AS (
           UPDATE agent_reflections
           SET run_id = $1
           WHERE run_id = $2
             AND created_at > NOW() - INTERVAL '2 hours'
           RETURNING 1
         )
         SELECT COUNT(*)::int AS updated FROM patched`,
        [agentRunId, runnerRunId],
      );
      const updated = row?.updated ?? 0;
      if (updated > 0) {
        console.log(`[Scheduler] Linked ${updated} reflection(s) to run UUID ${agentRunId}`);
        return;
      }
    } catch (err) {
      console.warn('[Scheduler] Reflection run_id reconciliation failed:', (err as Error).message);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

function truncateForLog(value: unknown, max = 900): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function mapWorkerRouteResultToExecutionResult(
  agentRole: CompanyAgentRole,
  routeResult: Awaited<ReturnType<typeof executeWorkerAgentRun>>,
): AgentExecutionResult {
  const normalizedStatus: AgentExecutionResult['status'] =
    routeResult.status === 'aborted'
      ? 'aborted'
      : routeResult.status === 'failed' || routeResult.action === 'rejected'
        ? 'error'
        : 'completed';

  let normalizedOutput: string | null = null;
  if (typeof routeResult.output === 'string') {
    normalizedOutput = routeResult.output;
  } else if (routeResult.output != null) {
    try {
      normalizedOutput = JSON.stringify(routeResult.output);
    } catch {
      normalizedOutput = String(routeResult.output);
    }
  }

  return {
    agentId: agentRole,
    role: agentRole,
    status: normalizedStatus,
    output: normalizedOutput,
    resultSummary: routeResult.reason,
    totalTurns: routeResult.totalTurns ?? 0,
    totalFilesWritten: routeResult.totalFilesWritten ?? 0,
    totalMemoryKeysWritten: routeResult.totalMemoryKeysWritten ?? 0,
    elapsedMs: routeResult.elapsedMs ?? 0,
    inputTokens: routeResult.inputTokens ?? 0,
    outputTokens: routeResult.outputTokens ?? 0,
    thinkingTokens: routeResult.thinkingTokens ?? 0,
    cachedInputTokens: routeResult.cachedInputTokens ?? 0,
    cost: routeResult.cost ?? 0,
    error: routeResult.error ?? undefined,
    actions: routeResult.actions,
    dashboardChatEmbeds: routeResult.dashboardChatEmbeds,
    conversationHistory: [],
  };
}

function isTransientFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return /timeout|timed out|429|rate limit|quota|temporar|econnreset|enotfound|socket|503|overloaded|try again/.test(normalized);
}

async function runAutoFailurePipeline(
  run: {
    runId?: string;
    agentRole: CompanyAgentRole;
    task: string;
    payload: Record<string, unknown>;
    errorMessage: string;
  },
): Promise<void> {
  const { runId, agentRole, task, payload, errorMessage } = run;
  const attempt = Number((payload.__autoRetryAttempt as number | undefined) ?? 0);
  const isPipelineRun = Boolean(payload.__autoFailurePipeline);
  const skipPipeline = Boolean(payload.__skipAutoFailurePipeline);

  if (isPipelineRun || skipPipeline || agentRole === 'ops') return;

  const shouldRetry =
    AUTO_RETRY_ON_FAILURE &&
    attempt < AUTO_RETRY_MAX_ATTEMPTS &&
    isTransientFailure(errorMessage);

  try {
    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      [
        'ops',
        'agent.auto_investigate',
        `Auto-investigate: ${agentRole} failed task=${task} run_id=${runId ?? 'unknown'} error=${truncateForLog(errorMessage, 420)} retry=${shouldRetry}`,
      ],
    );
  } catch (err) {
    console.warn('[Scheduler] Failed to write auto-investigate activity log:', (err as Error).message);
  }

  if (AUTO_INVESTIGATE_ON_FAILURE) {
    try {
      await trackedAgentExecutor('ops', 'event_response', {
        message: [
          'AUTO FAILURE INVESTIGATION',
          `Investigate and propose remediation for failed agent run.`,
          `Failed agent: ${agentRole}`,
          `Task: ${task}`,
          `Run ID: ${runId ?? 'unknown'}`,
          `Error: ${truncateForLog(errorMessage, 1200)}`,
          shouldRetry ? 'An automatic retry will be attempted once.' : 'No automatic retry will be attempted.',
        ].join('\n'),
        failed_agent_role: agentRole,
        failed_task: task,
        failed_run_id: runId ?? null,
        failed_error: truncateForLog(errorMessage, 2000),
        __autoFailurePipeline: true,
      });
    } catch (err) {
      console.warn('[Scheduler] Auto-investigation run failed:', (err as Error).message);
    }
  }

  if (shouldRetry) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await trackedAgentExecutor(agentRole, task, {
        ...payload,
        __autoRetryAttempt: attempt + 1,
        __skipAutoFailurePipeline: true,
      });
    } catch (err) {
      console.warn('[Scheduler] Auto-retry attempt failed:', (err as Error).message);
    }
  }
}

const trackedAgentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  if (!isLiveRuntimeRole(agentRole)) {
    return blockedRuntimeResult(agentRole);
  }

  const inputMsg = typeof payload?.message === 'string' ? payload.message : null;
  const startMs = Date.now();
  const requestedRunId = typeof payload?.runId === 'string' && UUID_RE.test(payload.runId.trim())
    ? payload.runId.trim()
    : null;
  let runtimeSessionId: string | null = null;
  let runtimeAttemptId: string | null = null;
  let runtimeDispatchRunId: string | null = null;
  let runtimeParentEventId: string | null = null;

  // Insert a "running" row in parallel with agent execution to avoid blocking
  const runIdPromise = (async () => {
    const [agentMeta] = await systemQuery<{
      tenant_id: string | null;
      created_via: string | null;
      created_by_client_id: string | null;
    }>(
      'SELECT tenant_id, created_via, created_by_client_id FROM company_agents WHERE role = $1',
      [agentRole],
    ).catch(() => []);

    const payloadTenantId = typeof payload?.tenantId === 'string'
      ? payload.tenantId
      : (typeof payload?.tenant_id === 'string' ? payload.tenant_id : null);
    const tenantId = payloadTenantId ?? agentMeta?.tenant_id ?? '00000000-0000-0000-0000-000000000000';
    const payloadSource = typeof payload?.source === 'string' ? payload.source : null;
    const source = payloadSource ?? (agentMeta?.created_via === 'client_sdk' ? 'client_sdk' : 'internal');
    const clientId = agentMeta?.created_by_client_id ?? null;

    try {
      const [row] = requestedRunId
        ? await systemQuery<{ id: string }>(
          'INSERT INTO agent_runs (id, agent_id, task, status, input, tenant_id, source, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [requestedRunId, agentRole, task, 'running', inputMsg, tenantId, source, clientId],
        )
        : await systemQuery<{ id: string }>(
          'INSERT INTO agent_runs (agent_id, task, status, input, tenant_id, source, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [agentRole, task, 'running', inputMsg, tenantId, source, clientId],
        );
      return row?.id as string | undefined;
    } catch {
      const [row] = requestedRunId
        ? await systemQuery<{ id: string }>(
          'INSERT INTO agent_runs (id, agent_id, task, status, input, tenant_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [requestedRunId, agentRole, task, 'running', inputMsg, tenantId],
        )
        : await systemQuery<{ id: string }>(
          'INSERT INTO agent_runs (agent_id, task, status, input, tenant_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [agentRole, task, 'running', inputMsg, tenantId],
        );
      return row?.id as string | undefined;
    }
  })().catch(() => undefined);

  try {
    const runId = await runIdPromise;
    const dispatchRunId = runId ?? requestedRunId ?? crypto.randomUUID();
    runtimeDispatchRunId = dispatchRunId;
    const ensuredRuntimeSessionId = await ensureRuntimeSession({
      sessionKey: `internal:${dispatchRunId}`,
      source: 'scheduler-non-chat',
      ownerUserId: null,
      ownerEmail: null,
      tenantId: typeof payload.tenantId === 'string'
        ? payload.tenantId
        : (typeof payload.tenant_id === 'string' ? payload.tenant_id : null),
      primaryAgentRole: agentRole,
      metadata: {
        nonChat: true,
        task,
        source: typeof payload.source === 'string' ? payload.source : 'scheduler',
        trigger: 'trackedAgentExecutor',
      },
      runId: dispatchRunId,
    });
    runtimeSessionId = ensuredRuntimeSessionId;
    const runtimeAttempt = await createRuntimeAttempt({
      sessionId: ensuredRuntimeSessionId,
      runId: dispatchRunId,
      triggeredBy: 'scheduler-system',
      triggerReason: task,
      requestPayload: {
        nonChat: true,
        agentRole,
        task,
        source: typeof payload.source === 'string' ? payload.source : 'scheduler',
      },
    });
    runtimeAttemptId = runtimeAttempt.id;
    const appendTrackedRuntimeEvent = async (
      eventType: Parameters<typeof appendRuntimeEvent>[0]['eventType'],
      eventPayload: Record<string, unknown>,
      status?: string,
      toolName?: string | null,
    ) => {
      const persisted = await appendRuntimeEvent({
        sessionId: ensuredRuntimeSessionId,
        attemptId: runtimeAttempt.id,
        runId: dispatchRunId,
        eventType,
        status: status ?? null,
        actorRole: agentRole,
        toolName: toolName ?? null,
        payload: eventPayload,
        parentEventId: runtimeParentEventId,
      });
      runtimeParentEventId = persisted.eventId;
    };
    await appendTrackedRuntimeEvent('run_created', {
      runId: dispatchRunId,
      agentRole,
      task,
      nonChat: true,
      source: 'trackedAgentExecutor',
    }, 'created');
    await markRuntimeAttemptRunning({ attemptId: runtimeAttempt.id });
    await appendTrackedRuntimeEvent('run_started', {
      runId: dispatchRunId,
      agentRole,
      task,
      nonChat: true,
    }, 'running');
    await appendTrackedRuntimeEvent('turn_started', {
      runId: dispatchRunId,
      task,
      nonChat: true,
    }, 'running');
    await appendTrackedRuntimeEvent('status', {
      runId: dispatchRunId,
      phase: 'running',
      message: `Executing ${agentRole}:${task}`,
      nonChat: true,
    }, 'running');

    const workerResult = await executeWorkerAgentRun({
      runId: dispatchRunId,
      agentRole,
      task,
      payload,
      message: typeof payload.message === 'string' ? payload.message : undefined,
      conversationHistory: Array.isArray(payload.conversationHistory)
        ? payload.conversationHistory as ConversationTurn[]
        : undefined,
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments as ConversationAttachment[]
        : undefined,
      assignmentId: typeof payload.assignmentId === 'string' ? payload.assignmentId : undefined,
      directiveId: typeof payload.directiveId === 'string' ? payload.directiveId : undefined,
    });
    const result = mapWorkerRouteResultToExecutionResult(agentRole, workerResult);
    const durationMs = Date.now() - startMs;

    // Count tool calls from conversation history
    const toolCalls = result?.conversationHistory
      ? result.conversationHistory.filter(t => t.role === 'tool_call').length
      : null;

    if (runId) {
      const runStatus = result?.status === 'completed'
        ? 'completed'
        : (result?.status === 'error' ? 'failed' : (result?.status ?? 'completed'));
      const normalizedRunError = runStatus === 'skipped_precheck'
        ? null
        : (result?.error ?? result?.abortReason ?? null);
      const reasoningMeta = (result as any)?.reasoningMeta;
      const verificationMeta = (result as any)?.verificationMeta;
      const updateParamsBase = [
        runStatus,
        new Date().toISOString(),
        durationMs,
        result?.totalTurns ?? null,
        toolCalls,
        result?.inputTokens ?? null,
        result?.outputTokens ?? null,
        result?.cost ?? null,
        result?.output ?? null,
        result?.resultSummary ?? null,
        normalizedRunError,
        result?.thinkingTokens ?? null,
        result?.cachedInputTokens ?? null,
        result?.routingRule ?? null,
        result?.routingCapabilities ?? null,
        result?.routingModel ?? null,
        result?.modelRoutingReason ?? null,
        result?.subtaskComplexity ?? null,
      ];
      try {
        await ensureAgentRunsRoutingSchema();
        // Compute AFTER ensureAgentRunsRoutingSchema so verificationPassesColumnType is resolved
        const verificationPassesValue = verificationMeta
          ? (verificationPassesColumnType === 'array' ? verificationMeta.passes : verificationMeta.passes.length)
          : null;
        await systemQuery(
          `UPDATE agent_runs SET status=$1, completed_at=$2, duration_ms=$3, turns=$4, tool_calls=$5, input_tokens=$6, output_tokens=$7, cost=$8, output=$9, result_summary=$10, error=$11, thinking_tokens=$12, cached_input_tokens=$13, routing_rule=$14, routing_capabilities=$15, routing_model=$16, model_routing_reason=$17, subtask_complexity=$18${reasoningMeta ? ', reasoning_passes=$19, reasoning_confidence=$20, reasoning_revised=$21, reasoning_cost_usd=$22' : ''}${verificationMeta ? ', verification_tier=$' + (reasoningMeta ? 23 : 19) + ', verification_reason=$' + (reasoningMeta ? 24 : 20) + ', verification_passes=$' + (reasoningMeta ? 25 : 21) : ''} WHERE id=$${reasoningMeta ? (verificationMeta ? 26 : 23) : (verificationMeta ? 22 : 19)}`,
          [
            ...updateParamsBase,
            ...(reasoningMeta ? [reasoningMeta.passes, reasoningMeta.confidence, reasoningMeta.revised, reasoningMeta.costUsd] : []),
            ...(verificationMeta ? [verificationMeta.tier, verificationMeta.reason, verificationPassesValue] : []),
            runId,
          ],
        );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[Scheduler] Routing schema update failed, falling back to legacy agent_runs update:', message);
        // Safe default: use integer (passes.length) when column type is unknown to avoid array→int4 error
        const fallbackVerificationPassesValue = verificationMeta
          ? (verificationPassesColumnType === 'array' ? verificationMeta.passes : verificationMeta.passes.length)
          : null;
        await systemQuery(
          `UPDATE agent_runs SET status=$1, completed_at=$2, duration_ms=$3, turns=$4, tool_calls=$5, input_tokens=$6, output_tokens=$7, cost=$8, output=$9, result_summary=$10, error=$11, thinking_tokens=$12, cached_input_tokens=$13${reasoningMeta ? ', reasoning_passes=$14, reasoning_confidence=$15, reasoning_revised=$16, reasoning_cost_usd=$17' : ''}${verificationMeta ? ', verification_tier=$' + (reasoningMeta ? 18 : 14) + ', verification_reason=$' + (reasoningMeta ? 19 : 15) + ', verification_passes=$' + (reasoningMeta ? 20 : 16) : ''} WHERE id=$${reasoningMeta ? (verificationMeta ? 21 : 18) : (verificationMeta ? 17 : 14)}`,
          [
            runStatus,
            new Date().toISOString(),
            durationMs,
            result?.totalTurns ?? null,
            toolCalls,
            result?.inputTokens ?? null,
            result?.outputTokens ?? null,
            result?.cost ?? null,
            result?.output ?? null,
            result?.resultSummary ?? null,
            normalizedRunError,
            result?.thinkingTokens ?? null,
            result?.cachedInputTokens ?? null,
            ...(reasoningMeta ? [reasoningMeta.passes, reasoningMeta.confidence, reasoningMeta.revised, reasoningMeta.costUsd] : []),
            ...(verificationMeta ? [verificationMeta.tier, verificationMeta.reason, fallbackVerificationPassesValue] : []),
            runId,
          ],
        );
      }

      try {
        await systemQuery(
          `UPDATE agent_runs SET
             plan_manifest = $1::jsonb,
             context_manifest = $2::jsonb,
             fast_path_reason = $3,
             mutating_tool_calls = $4,
             completion_gate_passed = $5
           WHERE id = $6`,
          [
            (result as { planManifest?: unknown }).planManifest != null
              ? JSON.stringify((result as { planManifest?: unknown }).planManifest)
              : null,
            (result as { contextManifest?: unknown }).contextManifest != null
              ? JSON.stringify((result as { contextManifest?: unknown }).contextManifest)
              : null,
            (result as { fastPathReason?: string | null }).fastPathReason ?? null,
            (result as { mutatingToolCalls?: number }).mutatingToolCalls ?? null,
            (result as { completionGatePassedFlag?: boolean }).completionGatePassedFlag ?? null,
            runId,
          ],
        );
      } catch (err) {
        console.warn('[Scheduler] Compliance manifest columns update skipped:', (err as Error).message);
      }

      try {
        const rs = result?.status ?? 'completed';
        recordAgentRunCompleted({
          status: rs === 'error' ? 'error' : rs,
          role: agentRole,
          task,
          planningMode: result?.executionPlanMeta?.mode,
          mutatingToolCalls: result?.mutatingToolCalls,
        });
      } catch (err) {
        console.warn('[Scheduler] OTel run metrics skipped:', (err as Error).message);
      }

      try {
        await systemQuery(
          `UPDATE agent_runs
              SET model = COALESCE($1, model),
                  actual_model = COALESCE($1, actual_model),
                  actual_provider = COALESCE($2, actual_provider),
                  estimated_cost_usd = COALESCE($3, estimated_cost_usd)
            WHERE id = $4`,
          [
            (result as any)?.actualModel ?? null,
            (result as any)?.actualProvider ?? null,
            (result as any)?.estimatedCostUsd ?? result?.cost ?? null,
            runId,
          ],
        );
      } catch (err) {
        console.warn('[Scheduler] Failed to persist actual model/provider attribution:', (err as Error).message);
      }

      // Cost rollup: aggregate tool costs and compute total
      try {
        const toolCostRows = await systemQuery<{ total_tool_cost: number | null }>(
          `SELECT SUM(estimated_cost_usd) AS total_tool_cost
           FROM tool_call_traces
           WHERE run_id = $1 AND estimated_cost_usd IS NOT NULL`,
          [runId],
        );
        const totalToolCost = toolCostRows[0]?.total_tool_cost ?? 0;
        const llmCost = (result as any)?.estimatedCostUsd ?? result?.cost ?? 0;
        const modelUsed = (result as any)?.actualModel ?? null;

        await systemQuery(
          `UPDATE agent_runs SET
             total_input_tokens    = COALESCE($2, total_input_tokens),
             total_output_tokens   = COALESCE($3, total_output_tokens),
             total_thinking_tokens = COALESCE($4, total_thinking_tokens),
             total_tool_cost_usd   = $5,
             llm_cost_usd          = $6,
             total_cost_usd        = $7,
             model_used            = COALESCE($8, model_used),
             cost_source           = 'instrumented'
           WHERE id = $1`,
          [
            runId,
            result?.inputTokens ?? null,
            result?.outputTokens ?? null,
            result?.thinkingTokens ?? null,
            totalToolCost,
            llmCost,
            totalToolCost + llmCost,
            modelUsed,
          ],
        );
      } catch (err) {
        console.warn('[Scheduler] Failed to persist cost rollup:', (err as Error).message);
      }

      if (typeof result?.compactionCount === 'number') {
        try {
          await systemQuery(
            'UPDATE agent_runs SET compaction_count=$1 WHERE id=$2',
            [result.compactionCount, runId],
          );
        } catch (err) {
          console.warn('[Scheduler] Failed to persist compaction count:', (err as Error).message);
        }
      }

      if (result?.agentId) {
        void reconcileReflectionRunIds(runId, result.agentId);
      }

      if (runStatus === 'failed') {
        void runAutoFailurePipeline({
          runId,
          agentRole,
          task,
          payload,
          errorMessage: result?.error ?? result?.abortReason ?? 'Unknown error',
        });
      }

      await storeAgentRunStatus(agentRole, task, runId, runStatus, result ?? undefined);

      // Reactive wake: emit failure events for live wake rules to pick up.
      if (runStatus === 'failed' || runStatus === 'aborted') {
        wakeRouter.processEvent({
          type: 'agent.run_failed',
          data: { agent_role: agentRole, task, run_id: runId, status: runStatus, error: result?.error ?? result?.abortReason ?? null },
          source: 'scheduler',
        }).catch(() => {});
      }
    }

    if (Array.isArray(workerResult.actions)) {
      for (const action of workerResult.actions) {
        await appendTrackedRuntimeEvent('tool_called', {
          tool: action.tool,
          params: action.params,
          nonChat: true,
        }, 'running', action.tool);
        await appendTrackedRuntimeEvent('tool_completed', {
          ...action,
          nonChat: true,
        }, action.result === 'success' ? 'completed' : 'failed', action.tool);
      }
    }

    const workerExecutionFailed =
      workerResult.error != null ||
      workerResult.status === 'failed' ||
      workerResult.action === 'rejected';
    await appendTrackedRuntimeEvent('result', {
      action: workerResult.action,
      status: workerResult.status,
      reason: workerResult.reason,
      error: workerResult.error,
      nonChat: true,
    }, workerExecutionFailed ? 'failed' : (workerResult.status ?? 'completed'));
    await appendTrackedRuntimeEvent(workerExecutionFailed ? 'run_failed' : 'run_completed', {
      error: workerResult.error ?? null,
      reason: workerResult.reason ?? null,
      nonChat: true,
    }, workerExecutionFailed ? 'failed' : 'completed');
    await markRuntimeAttemptTerminal({
      attemptId: runtimeAttempt.id,
      status: workerExecutionFailed
        ? 'failed'
        : (workerResult.action === 'queued_for_approval' ? 'queued_for_approval' : 'completed'),
      responseSummary: {
        action: workerResult.action,
        status: workerResult.status,
        reason: workerResult.reason,
      },
      errorMessage: workerResult.error ?? null,
    });
    await markRuntimeSessionTerminal({
      sessionId: runtimeSessionId,
      status: workerExecutionFailed ? 'failed' : 'completed',
    });

    // Process notification intents from agent output (fire-and-forget)
    if (result?.output && agentNotifier) {
      agentNotifier.processAgentOutput(agentRole, result.output)
        .then(n => { if (n > 0) console.log(`[AgentNotifier] ${agentRole} sent ${n} notification(s)`); })
        .catch(err => console.error(`[AgentNotifier] Error processing ${agentRole}:`, err));
      void relayUrgentFounderReplyIfNeeded({
        task,
        agentRole,
        inputMessage: inputMsg,
        output: result.output,
        payload,
        agentNotifier,
      }).then(n => {
        if (n > 0) console.log(`[urgentFounderRelay] ${agentRole} delivered ${n} founder notification(s)`);
      }).catch(err => console.error(`[urgentFounderRelay] ${agentRole}:`, err));
    }

    return result;
  } catch (err) {
    const runId = await runIdPromise;
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);

    if (runtimeSessionId && runtimeAttemptId && runtimeDispatchRunId) {
      try {
        const failedEvent = await appendRuntimeEvent({
          sessionId: runtimeSessionId,
          attemptId: runtimeAttemptId,
          runId: runtimeDispatchRunId,
          eventType: 'run_failed',
          status: 'failed',
          actorRole: agentRole,
          payload: {
            error: message,
            nonChat: true,
          },
          parentEventId: runtimeParentEventId,
        });
        runtimeParentEventId = failedEvent.eventId;
        await markRuntimeAttemptTerminal({
          attemptId: runtimeAttemptId,
          status: 'failed',
          responseSummary: { status: 'failed' },
          errorMessage: message,
        });
        await markRuntimeSessionTerminal({
          sessionId: runtimeSessionId,
          status: 'failed',
        });
      } catch (runtimeErr) {
        console.warn('[Scheduler] Failed to persist canonical runtime failure event:', (runtimeErr as Error).message);
      }
    }

    if (runId) {
      await systemQuery(
        'UPDATE agent_runs SET status=$1, completed_at=$2, duration_ms=$3, error=$4 WHERE id=$5',
        ['failed', new Date().toISOString(), durationMs, message, runId],
      );

      await storeAgentRunStatus(agentRole, task, runId, 'failed', undefined, message);

      void runAutoFailurePipeline({
        runId,
        agentRole,
        task,
        payload,
        errorMessage: message,
      });
    }

    throw err;
  }
};

const router = new EventRouter(trackedAgentExecutor, decisionQueue);
const wakeRouter = new WakeRouter(trackedAgentExecutor);
const contradictionAdminApi = createContradictionAdminApi(memory);
const contradictionProcessor = new ContradictionProcessor(memory, trackedAgentExecutor, null);
const heartbeatManager = new HeartbeatManager(
  trackedAgentExecutor,
  wakeRouter,
  async () => {
    await contradictionProcessor.processDetectedContradictions();
  },
);

const strategyModelClient = new ModelClient({
  geminiApiKey: process.env.GOOGLE_AI_API_KEY,
});
const analysisEngine = new AnalysisEngine(strategyModelClient);
const simulationEngine = new SimulationEngine(strategyModelClient);
const meetingEngine = new MeetingEngine(trackedAgentExecutor);
const cotEngine = new CotEngine(strategyModelClient);
const deepDiveEngine = new DeepDiveEngine(strategyModelClient);
const strategyLabEngine = new StrategyLabEngine(strategyModelClient, trackedAgentExecutor);
const handoffContractMonitor = new HandoffContractMonitor();
router.setCascadePreviewBuilder(async ({ action, tier }) => {
  const preview = await simulationEngine.runQuick({
    action,
    requestedBy: 'authority-gate',
    perspective: tier === 'red' ? 'pessimistic' : 'neutral',
    depth: 'lightweight',
    timeoutMs: 15000,
  });

  return {
    summary: preview.summary,
    simulationId: preview.simulationId,
    recommendation: preview.recommendation,
  };
});

// ─── Graph Chat Handler (1:1 DMs to agent Entra accounts) ──────

const GRAPH_CHAT_WEBHOOK_PATH = '/api/graph/chat-webhook';
let graphChatClient: GraphTeamsClient | null = null;
try { graphChatClient = GraphTeamsClient.fromEnv(); } catch { /* Graph not configured */ }

// Agent Notifier — delivers proactive DMs/cards when agents emit <notify> blocks
const agentNotifier = new AgentNotifier(graphChatClient);

// Wire the Graph client into the decision queue for Teams channel notifications
decisionQueue.setGraphClient(graphChatClient);

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
  // Wire Agent 365 Teams MCP client for chat replies (delegated permissions)
  const a365TeamsClient = A365TeamsChatClient.fromEnv();
  if (a365TeamsClient) graphChatHandler.setA365TeamsClient(a365TeamsClient);

  (async () => {
    try {
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

function authDenyHeaders(reason: string): Record<string, string> {
  return {
    'X-Glyphor-Auth-Result': 'deny',
    'X-Glyphor-Auth-Reason': reason,
  };
}

function json(
  res: ServerResponse,
  status: number,
  data: unknown,
  req?: IncomingMessage,
  extraHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders ?? {}),
  };
  if (req) appendCorsHeaders(req, headers);
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

// ─── Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const rawUrl = req.url ?? '/';
  const [url, queryString] = rawUrl.split('?');
  const params = new URLSearchParams(queryString ?? '');
  const method = req.method ?? 'GET';
  const authContext = await resolveRouteAuthContext(req, res, url, method);
  if (!authContext) return;
  const dashboardUser = authContext.dashboardUser;

  try {
    // CORS preflight — first so cross-origin dashboard fetches always get Allow-Origin on OPTIONS.
    if (method === 'OPTIONS') {
      const ch = corsHeadersFor(req);
      if (!Object.keys(ch).length) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(204, {
        ...ch,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

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

    // Retired platform-intel approvals are intentionally unavailable after the live-roster purge.
    if (method === 'GET' && url?.startsWith('/platform-intel/')) {
      json(res, 404, { error: 'platform-intel approvals are not available on the live roster' });
      return;
    }

    // Directive approval/rejection webhooks (GET from Teams card buttons)
    if (method === 'GET' && url?.startsWith('/directives/')) {
      const handled = await handleDirectiveApproval(url, req, res);
      if (handled) return;
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

    // DocuSign Connect webhook endpoint
    if (method === 'POST' && url === '/webhook/docusign') {
      const rawBody = await readBody(req);
      const result = handleDocuSignWebhook(rawBody, req.headers as Record<string, string | string[] | undefined>);

      // Reactive wake: notify live workflow handlers of DocuSign events
      if (result.status === 200 && 'event' in result.body) {
        try {
          const body = result.body as import('@glyphor/integrations').DocuSignWebhookResult;
          await wakeRouter.processEvent({
            type: `docusign.${body.event}`,
            data: {
              envelope_id: body.envelopeId,
              envelope_status: body.envelopeStatus,
              email_subject: body.emailSubject,
              summary: body.summary,
              signers: body.signers,
            },
            source: 'docusign',
          });

          // Log to activity_log
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              'chief-of-staff',
              `docusign.${body.event}`,
              body.summary,
              JSON.stringify({ envelope_id: body.envelopeId, signers: body.signers }),
            ],
          );
        } catch { /* wake + logging is best-effort */ }
      }

      json(res, result.status, result.body);
      return;
    }

    // CI failure → enqueue agent self-heal (GitHub Actions; Bearer CI_HEAL_WEBHOOK_SECRET)
    if (method === 'POST' && url === '/webhook/ci-heal') {
      if (!process.env.CI_HEAL_WEBHOOK_SECRET?.trim()) {
        json(res, 503, { error: 'CI heal webhook not configured' });
        return;
      }
      const rawBody = await readBody(req);
      if (!verifyCiHealBearer(getHeaderString(req.headers.authorization))) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = parseCiHealPayload(rawBody);
      if (!payload) {
        json(res, 400, { error: 'Invalid JSON payload' });
        return;
      }
      try {
        const result = await dispatchCiHealAgent(payload);
        if (!result.ok) {
          const status = result.error === 'Worker queue not configured' ? 503 : 500;
          json(res, status, { ok: false, error: result.error });
          return;
        }
        if ('deduped' in result && result.deduped) {
          json(res, 200, { ok: true, deduped: true });
          return;
        }
        json(res, 202, { ok: true, runId: result.runId });
      } catch (err) {
        console.error('[CiHeal] dispatch failed', err);
        json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Tool health tests (called by Cron or Dashboard)
    if (method === 'POST' && url === '/tool-health/run') {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
      try {
        const rawBody = await readBody(req);
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        const tiers = parsed.tiers ?? [1, 2, 3];
        const triggeredBy = parsed.triggeredBy ?? 'scheduled';
        
        const { runFullToolHealthCheck } = await import('@glyphor/agent-runtime');
        const summary = await runFullToolHealthCheck({
          triggeredBy,
          tiers,
        });

        json(res, 200, { success: true, summary });
      } catch (err) {
        json(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // Monthly model drift check (Cloud Scheduler; internal-only endpoint)
    if (method === 'POST' && (url === '/internal/model-check' || url === '/model-check/run')) {
      try {
        const summary = await runModelChecker();
        json(res, 200, { success: true, summary });
      } catch (err) {
        console.error('[ModelChecker] Unhandled error:', err);
        json(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    if (method === 'GET' && url === '/tool-health/latest') {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
      try {
        const { pool } = await import('@glyphor/shared/db');
        const run = await pool.query(`SELECT * FROM tool_test_runs ORDER BY started_at DESC LIMIT 1`);
        const topFailures = await pool.query(`
          SELECT tool_name, risk_tier, error_type, error_message, tested_at
          FROM tool_test_results
          WHERE test_run_id = $1 AND status = 'fail'
          ORDER BY tested_at DESC
        `, [run.rows[0]?.id]);
        json(res, 200, { success: true, run: run.rows[0], topFailures: topFailures.rows });
      } catch (err) {
        json(res, 500, { success: false, error: String(err) });
      }
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

        // Auto-dream v1 — after raw→distilled promotion, optionally run Nexus with
        // recall_memories/save_memory (gates + PG lease; see memoryConsolidationGates.ts).
        let fleetMemoryDream: {
          status: string;
          detail?: string;
          output?: string | null;
        } | null = null;

        if (process.env.AUTO_MEMORY_AGENT_CONSOLIDATION !== 'false') {
          const gate = await evaluateMemoryConsolidationGates();
          if (!gate.ok) {
            fleetMemoryDream = { status: 'skipped', detail: gate.reason };
          } else {
            const holder = `mem-${crypto.randomUUID().slice(0, 12)}`;
            const leased = await tryAcquireMemoryConsolidationLease(holder);
            if (!leased) {
              fleetMemoryDream = { status: 'skipped', detail: 'lease_held' };
            } else {
              let completed = false;
              try {
                const dreamMessage = buildMemoryConsolidationPromptMessage({
                  completedRunCount: gate.completedRunCount,
                  lastConsolidatedAt: gate.lastConsolidatedAt,
                  minHours: gate.minHours,
                });
                fleetMemoryDream = {
                  status: 'skipped',
                  detail: 'memory_consolidation_disabled_after_dead_agent_purge',
                };
                completed = true;
                await markMemoryConsolidationSuccess();
              } catch (dreamErr) {
                const msg = dreamErr instanceof Error ? dreamErr.message : String(dreamErr);
                fleetMemoryDream = { status: 'error', detail: msg };
                console.error('[MemoryConsolidator] Fleet memory dream error:', msg);
              } finally {
                if (!completed) {
                  await releaseMemoryConsolidationLease();
                }
              }
            }
          }
        }

        json(res, 200, { success: true, ...report, fleet_memory_dream: fleetMemoryDream });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[MemoryConsolidator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Agent dream consolidation — per-agent cross-session pattern extraction (Cloud Scheduler: 30 3 * * *)
    if (method === 'POST' && url === '/memory/agent-dream') {
      try {
        const { runFleetDreamConsolidation } = await import('./agentDreamConsolidator.js');
        const report = await runFleetDreamConsolidation();
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AgentDreamConsolidator] Endpoint error:', message);
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

    // Daily autonomy evaluator endpoint — applies configurable promotions and demotions.
    if (method === 'POST' && url === '/autonomy/evaluate-daily') {
      try {
        const changes = await processDailyAutonomyAdjustments();
        for (const change of changes) {
          const notifyBlock = [
            `<notify type="update" to="both" title="Autonomy ${change.changeType === 'auto_promote' ? 'promotion' : 'demotion'}: ${change.agentId}">`,
            `${change.agentId} moved from level ${change.fromLevel} to level ${change.toLevel}.`,
            `Reason: ${change.reason}`,
            `</notify>`,
          ].join('\n');
          await agentNotifier.processAgentOutput('ops', notifyBlock);
        }
        json(res, 200, { success: true, changed: changes.length, changes });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AutonomyDailyEval] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Shadow evaluation endpoint — runs shadow A/B tests for staged prompt versions
    if (method === 'POST' && url === '/shadow-eval/run') {
      try {
        const rawBody = await readBody(req).catch(() => '{}');
        const body = (rawBody.trim() ? JSON.parse(rawBody) : {}) as { agentId?: string; challengerVersion?: number };
        if (!body.agentId || !body.challengerVersion) {
          json(res, 400, { error: 'agentId and challengerVersion required' });
          return;
        }
        const tasks = await getPendingShadowTasks(body.agentId, 5);
        const results = [];
        for (const taskInput of tasks) {
          const result = await runShadow(body.agentId, taskInput, body.challengerVersion);
          if (result) results.push(result);
        }
        const promotion = await evaluatePromotion(body.agentId, body.challengerVersion);
        json(res, 200, { success: true, shadowRuns: results.length, promotion });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ShadowEval] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Shadow evaluation — run ALL pending challenger versions (cron-driven dequeue)
    if (method === 'POST' && url === '/shadow-eval/run-pending') {
      try {
        const pending = await getPendingChallengerVersions();
        console.log(`[ShadowEval] Found ${pending.length} pending challenger versions`);
        const results: Array<{ agentId: string; version: number; shadowRuns: number; promotion: string }> = [];
        for (const { agent_id: agentId, version } of pending) {
          const tasks = await getPendingShadowTasks(agentId, 5);
          let runCount = 0;
          for (const taskInput of tasks) {
            const result = await runShadow(agentId, taskInput, version);
            if (result) runCount++;
          }
          const promotion = await evaluatePromotion(agentId, version);
          results.push({ agentId, version, shadowRuns: runCount, promotion });
        }
        json(res, 200, { success: true, evaluated: results.length, results });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ShadowEval] Run-pending error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // World state health endpoint — freshness and staleness overview for dashboard
    if (method === 'GET' && url === '/world-state/health') {
      try {
        const health = await getWorldStateHealth();
        json(res, 200, { success: true, ...health });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[WorldStateHealth] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Cascade prediction evaluator endpoint — weekly calibration of prior cascade calls
    if (method === 'POST' && url === '/cascade/evaluate') {
      try {
        const result = await evaluateCascadePredictions();
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[CascadePredictionEvaluator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    if (method === 'POST' && url === '/predictions/resolve') {
      try {
        const result = await resolvePredictionJournal();
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PredictionResolver] Endpoint error:', message);
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

    // Planning-gate monitor endpoint — daily quality regression alert check
    if (method === 'POST' && url === '/planning-gate/monitor') {
      try {
        const report = await evaluatePlanningGateHealth();
        if (report.alerts.length > 0) {
          const summary = report.alerts.map((alert) => alert.message).join(' | ');
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              'ops',
              'planning_gate.alert',
              summary,
              JSON.stringify({
                window_days: report.windowDays,
                runs_with_planning: report.runsWithPlanning,
                gate_pass_rate: report.gatePassRate,
                max_retry_attempt: report.maxRetryAttempt,
                alerts: report.alerts,
                top_role_regressions: report.topRoleRegressions,
              }),
            ],
          );

          const incidentTitle = 'Planning gate quality regression';
          const existing = await systemQuery<{ id: string }>(
            `SELECT id
               FROM incidents
              WHERE title = $1
                AND status = 'open'
                AND created_at >= NOW() - INTERVAL '24 hours'
              ORDER BY created_at DESC
              LIMIT 1`,
            [incidentTitle],
          );
          if (existing.length === 0) {
            await systemQuery(
              `INSERT INTO incidents (severity, title, description, affected_agents, status, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [
                'high',
                incidentTitle,
                summary,
                report.topRoleRegressions.map((entry) => entry.role),
                'open',
                'scheduler',
              ],
            );
          }

          const notifyBlock = [
            `<notify type="blocker" to="both" title="Planning gate quality alert">`,
            summary,
            `Window: ${report.windowDays}d`,
            `Planned runs: ${report.runsWithPlanning}`,
            `Gate pass rate: ${Math.round(report.gatePassRate * 100)}%`,
            `Max retry attempt: ${report.maxRetryAttempt}`,
            `</notify>`,
          ].join('\n');
          await agentNotifier.processAgentOutput('ops', notifyBlock);
        }
        json(res, 200, { success: true, ...report, alerted: report.alerts.length > 0 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PlanningGateMonitor] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Trust quality monitor — daily evidence tier and claim fabrication alert check
    if (method === 'POST' && url === '/trust/monitor') {
      try {
        const report = await evaluateTrustQuality();
        if (report.alerts.length > 0) {
          const summary = report.alerts.map((a) => a.message).join(' | ');
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [
              'ops',
              'trust_quality.alert',
              summary,
              JSON.stringify({
                window_days: report.windowDays,
                total_runs: report.totalRuns,
                self_reported_rate: report.selfReportedRate,
                downgrade_rate: report.downgradeRate,
                claim_fabrication_events: report.claimFabricationEvents,
                alerts: report.alerts,
              }),
            ],
          );

          const incidentTitle = 'Trust quality degradation';
          const existing = await systemQuery<{ id: string }>(
            `SELECT id FROM incidents
              WHERE title = $1 AND status = 'open'
                AND created_at >= NOW() - INTERVAL '24 hours'
              LIMIT 1`,
            [incidentTitle],
          );
          if (existing.length === 0) {
            await systemQuery(
              `INSERT INTO incidents (severity, title, description, affected_agents, status, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [
                'high',
                incidentTitle,
                summary,
                report.alerts.flatMap((a) => a.affectedAgents ?? []),
                'open',
                'scheduler',
              ],
            );
          }

          const notifyBlock = [
            `<notify type="blocker" to="both" title="Trust quality alert">`,
            summary,
            `Window: ${report.windowDays}d | Runs: ${report.totalRuns}`,
            `Self-reported rate: ${Math.round(report.selfReportedRate * 100)}%`,
            `Downgrade rate: ${Math.round(report.downgradeRate * 100)}%`,
            `Claim fabrication events: ${report.claimFabricationEvents}`,
            `</notify>`,
          ].join('\n');
          await agentNotifier.processAgentOutput('ops', notifyBlock);
        }
        json(res, 200, { success: true, ...report, alerted: report.alerts.length > 0 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[TrustQualityMonitor] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Economics guardrails — optional Teams webhook or AgentNotifier (Cloud Scheduler)
    if (method === 'POST' && url === '/economics/guardrail-notify') {
      try {
        const result = await runEconomicsGuardrailNotify(agentNotifier);
        const { success, ...rest } = result;
        json(res, success ? 200 : 500, { success, ...rest });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[EconomicsGuardrailNotify] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Agent knowledge-gap evaluation endpoint — weekly judge-scored readiness sweep
    if (method === 'POST' && url === '/agent-evals/run') {
      try {
        const rawBody = await readBody(req).catch(() => '{}');
        const body = (rawBody.trim() ? JSON.parse(rawBody) : {}) as {
          agentRole?: string;
          agentRoles?: unknown;
          agentIds?: unknown;
          goldenOnly?: unknown;
        };
        const fromArrays: string[] = [];
        if (Array.isArray(body.agentIds)) {
          for (const id of body.agentIds) {
            if (typeof id === 'string' && id.trim()) fromArrays.push(id.trim());
          }
        }
        if (Array.isArray(body.agentRoles)) {
          for (const r of body.agentRoles) {
            if (typeof r === 'string' && r.trim()) fromArrays.push(r.trim());
          }
        }
        const uniqueFromArrays = [...new Set(fromArrays)];
        const report = await evaluateAgentKnowledgeGaps(
          uniqueFromArrays.length > 0
            ? { agentRoles: uniqueFromArrays, goldenOnly: body.goldenOnly === true }
            : {
              agentRole: typeof body.agentRole === 'string' ? body.agentRole : undefined,
              goldenOnly: body.goldenOnly === true,
            },
        );
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AgentKnowledgeEvaluator] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Golden-task evaluation endpoint — focused quality suite for canary hardening
    if (method === 'POST' && url === '/agent-evals/run-golden') {
      try {
        const rawBody = await readBody(req).catch(() => '{}');
        const body = (rawBody.trim() ? JSON.parse(rawBody) : {}) as {
          agentRole?: string;
          agentRoles?: unknown;
          agentIds?: unknown;
        };
        const fromArrays: string[] = [];
        if (Array.isArray(body.agentIds)) {
          for (const id of body.agentIds) {
            if (typeof id === 'string' && id.trim()) fromArrays.push(id.trim());
          }
        }
        if (Array.isArray(body.agentRoles)) {
          for (const role of body.agentRoles) {
            if (typeof role === 'string' && role.trim()) fromArrays.push(role.trim());
          }
        }
        const uniqueFromArrays = [...new Set(fromArrays)];
        const report = await evaluateAgentKnowledgeGaps(
          uniqueFromArrays.length > 0
            ? { agentRoles: uniqueFromArrays, goldenOnly: true }
            : { agentRole: typeof body.agentRole === 'string' ? body.agentRole : undefined, goldenOnly: true },
        );
        json(res, 200, { success: true, suite: 'golden', ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AgentKnowledgeEvaluator] Golden endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // GTM Readiness — run evaluation (Cloud Scheduler: 0 13 * * *)
    if (method === 'POST' && url === '/gtm-readiness/run') {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
      try {
        const report = await runGtmReadinessEval();
        await persistGtmReport(report);
        json(res, 200, { success: true, ...report });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GtmReadiness] Endpoint error:', message);
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // GTM Readiness — latest report
    if (method === 'GET' && url === '/api/eval/gtm-readiness/latest') {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
      try {
        const rows = await systemQuery<{ report_json: unknown }>(
          `SELECT report_json FROM gtm_readiness_reports ORDER BY generated_at DESC LIMIT 1`
        );
        json(res, 200, rows[0]?.report_json ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GtmReadiness] Latest endpoint error:', message);
        json(res, 500, { error: message });
      }
      return;
    }

    // GTM Readiness — report history
    if (method === 'GET' && url === '/api/eval/gtm-readiness/history') {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
      try {
        const rows = await systemQuery(
          `SELECT id, generated_at, overall, marketing_department_ready,
                  passing_count, failing_count, insufficient_data_count
           FROM gtm_readiness_reports
           ORDER BY generated_at DESC
           LIMIT 30`
        );
        json(res, 200, rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GtmReadiness] History endpoint error:', message);
        json(res, 500, { error: message });
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
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
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

    // Agent365 activity endpoint — receives Action.Execute invokes from Teams adaptive cards.
    if (method === 'POST' && (url === '/api/messages' || url === '/api/agent365/activity')) {
      await handleAgent365ActivityRequest(req, res);
      return;
    }

    if (method === 'GET' && url === '/run/events') {
      if (!dashboardUser) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const conversationId = params.get('conversation_id');
      if (!conversationId) {
        json(res, 400, { error: 'conversation_id is required' });
        return;
      }
      const fromSeq = parseNumericCursor(params.get('from_seq'));
      const sessionId = await findSessionIdBySessionKey(conversationId);
      if (!sessionId) {
        json(res, 200, { conversationId, next_cursor: fromSeq, events: [] });
        return;
      }
      const replayFromSeq = fromSeq;
      const replay = await replayRuntimeEventsBySeq({
        sessionId,
        fromSeq: replayFromSeq,
        limit: 500,
      });
      json(res, 200, {
        conversationId,
        sessionId,
        next_cursor: replay.nextCursor,
        events: replay.events,
      });
      return;
    }

    if (method === 'GET' && url === '/run/events/stream') {
      if (!dashboardUser) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const conversationId = params.get('conversation_id');
      if (!conversationId) {
        json(res, 400, { error: 'conversation_id is required' });
        return;
      }
      const fromSeq = parseNumericCursor(params.get('from_seq'));
      const sessionId = await findSessionIdBySessionKey(conversationId);
      const lastEventIdHeader = getHeaderString(req.headers['last-event-id']);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeadersFor(req),
      });

      if (!sessionId) {
        sendSseEvent(res, {
          type: 'replay',
          conversationId,
          nextCursor: fromSeq,
          events: [],
        });
        res.end();
        return;
      }

      const headerCursor = lastEventIdHeader && sessionId
        ? await resolveRuntimeCursorFromEventId({ sessionId, eventId: lastEventIdHeader })
        : 0;
      const replayFromSeq = Math.max(fromSeq, headerCursor);
      const replay = await replayRuntimeEventsBySeq({
        sessionId,
        fromSeq: replayFromSeq,
        limit: 500,
      });
      sendSseEvent(res, {
        type: 'replay',
        conversationId,
        sessionId,
        nextCursor: replay.nextCursor,
        events: replay.events,
      });
      res.end();
      return;
    }

    if (method === 'POST' && url === '/run/stream') {
      if (!dashboardUser) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const body = JSON.parse(await readBody(req)) as DashboardRunRequestBody;
      const normalized = normalizeDashboardRunRequest({
        body,
        dashboardUserEmail: dashboardUser.email,
        dbRunIdTurnPrefix: DB_RUN_ID_TURN_PREFIX,
      });
      const sessionId = await ensureRuntimeSession({
        sessionKey: normalized.conversationId,
        source: 'dashboard-main-chat',
        ownerUserId: dashboardUser.uid,
        ownerEmail: dashboardUser.email,
        primaryAgentRole: normalized.agentRole,
        metadata: { stream: true },
        runId: normalized.runId,
      });
      const attempt = await createRuntimeAttempt({
        sessionId,
        runId: normalized.runId,
        triggeredBy: 'dashboard-user',
        triggerReason: 'chat_stream',
        requestPayload: {
          task: normalized.task,
          message: normalized.originalMessage,
          persistTranscript: normalized.persistTranscript,
        },
      });
      let lastEventId: string | null = null;
      const recordRuntimeEvent = async (
        event: Record<string, unknown>,
        eventType: Parameters<typeof appendRuntimeEvent>[0]['eventType'],
        toolName?: string | null,
      ) => {
        const persisted = await appendRuntimeEvent({
          sessionId,
          attemptId: attempt.id,
          runId: normalized.runId,
          eventType,
          status: typeof event.status === 'string' ? event.status : null,
          actorRole: normalized.agentRole,
          toolName: toolName ?? null,
          payload: event,
          parentEventId: lastEventId,
        });
        lastEventId = persisted.eventId;
        return persisted;
      };
      const emitAndRecord = async (
        event: Record<string, unknown>,
        eventType: Parameters<typeof appendRuntimeEvent>[0]['eventType'],
      ) => {
        const persisted = await recordRuntimeEvent(event, eventType);
        sendSseEvent(res, { ...event, seq: persisted.seq, event_id: persisted.eventId });
      };

      await recordRuntimeEvent({
        type: 'run_created',
        runId: normalized.runId,
        conversationId: normalized.conversationId,
        task: normalized.task,
        attemptNumber: attempt.attemptNumber,
        status: 'created',
      }, 'run_created');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeadersFor(req),
      });

      const heartbeat = setInterval(() => {
        void emitAndRecord({ type: 'heartbeat', runId: normalized.runId, at: new Date().toISOString() }, 'heartbeat');
      }, 5000);

      try {
        await markRuntimeAttemptRunning({ attemptId: attempt.id });
        await recordRuntimeEvent({
          type: 'turn_started',
          runId: normalized.runId,
          conversationId: normalized.conversationId,
          stream: true,
          persistTranscript: normalized.persistTranscript,
          status: 'running',
        }, 'turn_started');

        if (normalized.persistTranscript) {
          await persistDashboardChatMessage({
            agentRole: normalized.agentRole,
            role: 'user',
            content: normalized.originalMessage,
            userId: dashboardUser.email,
            conversationId: normalized.conversationId,
            sessionId: normalized.runId,
            attachments: normalized.attachments,
            metadata: { runId: normalized.runId, streaming: true },
          });
        }

        await emitAndRecord({
          type: 'run_started',
          runId: normalized.runId,
          agentRole: normalized.agentRole,
          conversationId: normalized.conversationId,
          status: 'running',
          phase: 'delegation',
          message: `Delegating to ${normalized.agentRole}...`,
        }, 'run_started');

        await emitAndRecord({
          type: 'status',
          runId: normalized.runId,
          phase: 'delegation',
          status: 'running',
          message: `Delegating to ${normalized.agentRole}...`,
        }, 'status');

        const result = await executeWorkerAgentRun({
          runId: normalized.runId,
          agentRole: normalized.agentRole,
          task: normalized.task,
          payload: normalized.payload,
          message: normalized.message,
          conversationHistory: normalized.conversationHistory,
          attachments: normalized.attachments,
        });

        if (Array.isArray(result.actions)) {
          for (const action of result.actions) {
            await recordRuntimeEvent({
              type: 'tool_called',
              runId: normalized.runId,
              tool: action.tool,
              params: action.params,
              status: 'running',
              phase: 'execution',
            }, 'tool_called', action.tool);
            await recordRuntimeEvent({
              ...action,
              type: 'tool_completed',
              runId: normalized.runId,
              status: action.result === 'success' ? 'completed' : 'failed',
              phase: action.result === 'success' ? 'execution' : 'failure',
            }, 'tool_completed', action.tool);
            await emitAndRecord({
              type: 'action_receipt',
              runId: normalized.runId,
              action,
            }, 'status');
          }
        }

        const transcriptContent = buildDashboardResultContent({
          output: result.output,
          action: result.action,
          status: result.status,
          error: result.error,
          reason: result.reason,
        });
        const transcriptMetadata: Record<string, unknown> = {
          runId: normalized.runId,
          status: result.status ?? null,
          action: result.action,
          actions: result.actions ?? [],
          dashboardChatEmbeds: result.dashboardChatEmbeds ?? [],
          streamed: true,
        };
        if (normalized.persistTranscript) {
          await persistDashboardChatMessage({
            agentRole: normalized.agentRole,
            role: 'agent',
            content: transcriptContent,
            userId: dashboardUser.email,
            conversationId: normalized.conversationId,
            sessionId: normalized.runId,
            metadata: transcriptMetadata,
          });
        }

        if (result.action === 'queued_for_approval') {
          await recordRuntimeEvent({
            type: 'approval_requested',
            runId: normalized.runId,
            reason: result.reason,
            status: 'queued_for_approval',
            phase: 'approval',
            message: 'Approval required before this run can continue.',
          }, 'approval_requested');
          await emitAndRecord({
            type: 'status',
            runId: normalized.runId,
            status: 'queued_for_approval',
            phase: 'approval',
            message: 'Approval required before this run can continue.',
          }, 'status');
        }

        await emitAndRecord({
          type: 'result',
          runId: normalized.runId,
          data: result,
          transcriptContent,
          conversationId: normalized.conversationId,
        }, 'result');

        await emitAndRecord({
          type: 'status',
          runId: normalized.runId,
          status: result.error ? 'failed' : (result.action === 'queued_for_approval' ? 'queued_for_approval' : 'completed'),
          phase: result.error ? 'failure' : (result.action === 'queued_for_approval' ? 'approval' : 'completion'),
          message: result.error
            ? 'Run failed. Review details and retry if needed.'
            : (result.action === 'queued_for_approval'
              ? 'Awaiting approval.'
              : 'Run completed successfully.'),
        }, 'status');

        await recordRuntimeEvent({
          type: 'run_completed',
          runId: normalized.runId,
          hasError: Boolean(result.error),
          status: result.error ? 'failed' : 'completed',
          phase: result.error ? 'failure' : 'completion',
        }, 'run_completed');
        await markRuntimeAttemptTerminal({
          attemptId: attempt.id,
          status: result.error ? 'failed' : result.action === 'queued_for_approval' ? 'queued_for_approval' : 'completed',
          responseSummary: {
            action: result.action,
            status: result.status,
            reason: result.reason,
          },
          errorMessage: result.error ?? null,
        });
        await markRuntimeSessionTerminal({
          sessionId,
          status: result.error ? 'failed' : 'completed',
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : String(err);
        const retryHint = /\bretry\b/i.test(messageText)
          ? 'Retry is in progress. We will update this stream when it completes.'
          : null;
        await emitAndRecord({
          type: 'status',
          runId: normalized.runId,
          status: 'failed',
          phase: retryHint ? 'retry' : 'failure',
          message: retryHint ?? 'Run failed. Review details and retry if needed.',
        }, 'status');
        await emitAndRecord({
          type: 'error',
          runId: normalized.runId,
          error: messageText,
        }, 'status');
        await recordRuntimeEvent({
          type: 'run_failed',
          runId: normalized.runId,
          error: messageText,
          status: 'failed',
          phase: 'failure',
        }, 'run_failed');
        await markRuntimeAttemptTerminal({
          attemptId: attempt.id,
          status: 'failed',
          responseSummary: { status: 'failed' },
          errorMessage: messageText,
        });
        await markRuntimeSessionTerminal({
          sessionId,
          status: 'failed',
        });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return;
    }

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      if (!dashboardUser) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      const body = JSON.parse(await readBody(req)) as DashboardRunRequestBody;
      const normalized = normalizeDashboardRunRequest({
        body,
        dashboardUserEmail: dashboardUser.email,
        dbRunIdTurnPrefix: DB_RUN_ID_TURN_PREFIX,
      });
      const sessionId = await ensureRuntimeSession({
        sessionKey: normalized.conversationId,
        source: 'dashboard-main-chat',
        ownerUserId: dashboardUser.uid,
        ownerEmail: dashboardUser.email,
        primaryAgentRole: normalized.agentRole,
        metadata: { stream: false },
        runId: normalized.runId,
      });
      const attempt = await createRuntimeAttempt({
        sessionId,
        runId: normalized.runId,
        triggeredBy: 'dashboard-user',
        triggerReason: 'chat_sync',
        requestPayload: {
          task: normalized.task,
          message: normalized.originalMessage,
          persistTranscript: normalized.persistTranscript,
        },
      });
      let parentEventId: string | null = null;
      const persistEvent = async (eventType: Parameters<typeof appendRuntimeEvent>[0]['eventType'], payload: Record<string, unknown>, status?: string) => {
        const persisted = await appendRuntimeEvent({
          sessionId,
          attemptId: attempt.id,
          runId: normalized.runId,
          eventType,
          status: status ?? null,
          actorRole: normalized.agentRole,
          payload,
          parentEventId,
        });
        parentEventId = persisted.eventId;
      };

      await markRuntimeAttemptRunning({ attemptId: attempt.id });
      await persistEvent('run_created', {
        runId: normalized.runId,
        conversationId: normalized.conversationId,
        task: normalized.task,
        attemptNumber: attempt.attemptNumber,
      }, 'created');
      await persistEvent('run_started', {
        runId: normalized.runId,
      }, 'running');
      await persistEvent('turn_started', {
        conversationId: normalized.conversationId,
      }, 'running');
      await persistEvent('status', {
        phase: 'running',
        message: `Working with ${normalized.agentRole}...`,
      }, 'running');

      const result = await executeWorkerAgentRun({
        runId: normalized.runId,
        agentRole: normalized.agentRole,
        task: normalized.task,
        payload: normalized.payload,
        message: normalized.message,
        conversationHistory: normalized.conversationHistory,
        attachments: normalized.attachments,
      });

      if (normalized.persistTranscript) {
        await persistDashboardChatMessage({
          agentRole: normalized.agentRole,
          role: 'user',
          content: normalized.originalMessage,
          userId: dashboardUser.email,
          conversationId: normalized.conversationId,
          sessionId: normalized.runId,
          attachments: normalized.attachments,
          metadata: { runId: normalized.runId, streaming: false },
        });
        await persistDashboardChatMessage({
          agentRole: normalized.agentRole,
          role: 'agent',
          content: buildDashboardResultContent({
            output: result.output,
            action: result.action,
            status: result.status,
            error: result.error,
            reason: result.reason,
          }),
          userId: dashboardUser.email,
          conversationId: normalized.conversationId,
          sessionId: normalized.runId,
          metadata: {
            runId: normalized.runId,
            status: result.status ?? null,
            action: result.action,
            actions: result.actions ?? [],
            dashboardChatEmbeds: result.dashboardChatEmbeds ?? [],
            streamed: false,
          },
        });
      }
      if (Array.isArray(result.actions)) {
        for (const action of result.actions) {
          await persistEvent('tool_called', {
            tool: action.tool,
            params: action.params,
          }, 'running');
          await persistEvent('tool_completed', action, action.result === 'success' ? 'completed' : 'failed');
        }
      }
      if (result.action === 'queued_for_approval') {
        await persistEvent('approval_requested', { reason: result.reason }, 'queued_for_approval');
      }
      await persistEvent('result', {
        action: result.action,
        status: result.status,
        reason: result.reason,
      }, result.status ?? (result.error ? 'failed' : 'completed'));
      await persistEvent(result.error ? 'run_failed' : 'run_completed', {
        error: result.error ?? null,
      }, result.error ? 'failed' : 'completed');
      await markRuntimeAttemptTerminal({
        attemptId: attempt.id,
        status: result.error ? 'failed' : result.action === 'queued_for_approval' ? 'queued_for_approval' : 'completed',
        responseSummary: {
          action: result.action,
          status: result.status,
          reason: result.reason,
        },
        errorMessage: result.error ?? null,
      });
      await markRuntimeSessionTerminal({
        sessionId,
        status: result.error ? 'failed' : 'completed',
      });

      // Record agent output back to work_assignments if this run was dispatched by orchestration
      const assignmentId = normalized.payload?.directiveAssignmentId as string | undefined;
      if (assignmentId && result.action === 'executed') {
        await systemQuery(
          'UPDATE work_assignments SET agent_output=$1, status=$2, completed_at=$3 WHERE id=$4',
          [result.output ?? result.error ?? 'No output captured', result.error ? 'failed' : 'completed', new Date().toISOString(), assignmentId],
        );
        if (result.error) {
          await failContractForTask(
            assignmentId,
            normalized.agentRole,
            result.error,
            {
              output: result.output ?? result.error,
              assignmentId,
              submittedBy: normalized.agentRole,
              status: 'failed',
            },
          );
        } else {
          await completeContractForTask(
            assignmentId,
            normalized.agentRole,
            {
              output: result.output ?? 'No output captured',
              assignmentId,
              submittedBy: normalized.agentRole,
              status: 'completed',
            },
            // Scale confidence by output length. Must stay ≥ 0.7 (DEFAULT_HANDOFF_CONFIDENCE_THRESHOLD)
            // for outputs that pass the gate, otherwise the contract escalates instead of completing.
            (() => {
              const len = (result.output ?? '').trim().length;
              return len >= 500 ? 1.0 : len >= 300 ? 0.9 : 0.75;
            })(),
          );
        }
      }

      json(res, 200, result);
      return;
    }

    if (method === 'GET' && url === '/sdk/agents') {
      const client = await requireSdkClient(req, res);
      if (!client) return;
      const agents = await listClientSdkAgents(client);
      json(res, 200, agents);
      return;
    }

    if (method === 'POST' && url === '/sdk/agents') {
      const client = await requireSdkClient(req, res);
      if (!client) return;
      try {
        const body = JSON.parse(await readBody(req));
        const agent = await createClientSdkAgent(client, body);
        json(res, 201, agent);
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return;
    }

    const sdkAgentMatch = url.match(/^\/sdk\/agents\/([^/]+)$/);
    if (method === 'GET' && sdkAgentMatch) {
      const client = await requireSdkClient(req, res);
      if (!client) return;
      const role = decodeURIComponent(sdkAgentMatch[1]);
      const agent = await getClientSdkAgent(client, role);
      if (!agent) {
        json(res, 404, { error: 'Agent not found' });
        return;
      }
      json(res, 200, agent);
      return;
    }

    const sdkRetireMatch = url.match(/^\/sdk\/agents\/([^/]+)\/retire$/);
    if (method === 'POST' && sdkRetireMatch) {
      const client = await requireSdkClient(req, res);
      if (!client) return;
      try {
        const role = decodeURIComponent(sdkRetireMatch[1]);
        const body = JSON.parse(await readBody(req));
        const agent = await retireClientSdkAgent(client, role, body);
        json(res, 200, agent);
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
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
          [agentId, name, name, name, title ?? '', department ?? '', reports_to ?? null, 'active', model || getTierModel('default'), temperature ?? 0.3, max_turns ?? 10, budget_per_run ?? 0.05, budget_daily ?? 0.50, budget_monthly ?? 15, is_temporary || false, is_temporary && ttl_days ? new Date(Date.now() + ttl_days * 86400000).toISOString() : null, false, new Date().toISOString(), new Date().toISOString()],
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
      await systemQuery('INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)', ['system', 'agent.created', `New agent created: ${name} (${agentId})`]);

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
      const agentKey = decodeURIComponent(settingsMatch[1]);
      const updates = JSON.parse(await readBody(req));

      const targetRows = await systemQuery<{
        id: string;
        role: string;
      }>(
        'SELECT id, role FROM company_agents WHERE id::text = $1 OR role = $1 LIMIT 1',
        [agentKey],
      );

      if (targetRows.length === 0) {
        json(res, 404, { success: false, error: `Agent not found: ${agentKey}` });
        return;
      }

      const targetAgent = targetRows[0];

      const { system_prompt, ...agentUpdates } = updates;

      // Accept manager values as role/id/name/display_name and normalize to role.
      if (Object.prototype.hasOwnProperty.call(agentUpdates, 'reports_to')) {
        const managerRaw = (agentUpdates as Record<string, unknown>).reports_to;
        if (managerRaw === '' || managerRaw == null) {
          (agentUpdates as Record<string, unknown>).reports_to = null;
        } else {
          const managerText = String(managerRaw).trim();
          const managerRows = await systemQuery<{ role: string }>(
            `SELECT role
             FROM company_agents
             WHERE role = $1
                OR id::text = $1
                OR name = $1
                OR display_name = $1
             LIMIT 1`,
            [managerText],
          );
          if (managerRows.length > 0) {
            (agentUpdates as Record<string, unknown>).reports_to = managerRows[0].role;
          } else {
            json(res, 400, { success: false, error: `Unknown manager: ${managerText}` });
            return;
          }
        }
      }

      let data;
      try {
        const normalizedUpdates = { ...agentUpdates, updated_at: new Date().toISOString() };
        const keys = Object.keys(normalizedUpdates);
        const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
        const values = keys.map(k => (normalizedUpdates as Record<string, unknown>)[k]);
        values.push(targetAgent.id);
        [data] = await systemQuery(`UPDATE company_agents SET ${setClause} WHERE id=$${keys.length + 1} RETURNING *`, values);
      } catch (updateErr) {
        json(res, 400, { success: false, error: (updateErr as Error).message });
        return;
      }

      if (system_prompt !== undefined) {
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, updated_at) VALUES ($1,$2,$3)
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt=EXCLUDED.system_prompt, updated_at=EXCLUDED.updated_at`,
          [targetAgent.role, system_prompt, new Date().toISOString()],
        );
      }

      await systemQuery('INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)', ['system', 'agent.settings_updated', `Settings updated for ${targetAgent.role}: ${Object.keys(agentUpdates).join(', ')}`]);

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
      const agentRef = decodeURIComponent(pauseMatch[1]);
      const [updated] = await systemQuery<{ role: string }>(
        'UPDATE company_agents SET status=$1, updated_at=$2 WHERE id::text=$3 OR role=$3 RETURNING role',
        ['paused', new Date().toISOString(), agentRef],
      );
      if (!updated) {
        json(res, 404, { success: false, error: `Agent not found: ${agentRef}` });
        return;
      }
      json(res, 200, { success: true, role: updated.role });
      return;
    }

    // Resume agent
    const resumeMatch = url.match(/^\/agents\/([^/]+)\/resume$/);
    if (method === 'POST' && resumeMatch) {
      const agentRef = decodeURIComponent(resumeMatch[1]);
      const [updated] = await systemQuery<{ role: string }>(
        'UPDATE company_agents SET status=$1, updated_at=$2 WHERE id::text=$3 OR role=$3 RETURNING role',
        ['active', new Date().toISOString(), agentRef],
      );
      if (!updated) {
        json(res, 404, { success: false, error: `Agent not found: ${agentRef}` });
        return;
      }
      json(res, 200, { success: true, role: updated.role });
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

        // Hard delete from all DB tables (must clear FK-referencing tables first)
        await systemQuery('DELETE FROM agent_schedules WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_briefs WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_skills WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_profiles WHERE agent_id=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_reasoning_config WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM agent_tool_grants WHERE agent_role=$1', [agentRole]);
        await systemQuery('DELETE FROM proposed_skills WHERE source_agent=$1', [agentRole]);
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

        await systemQuery('INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)', ['system', 'agent.deleted', `Agent hard-deleted: ${agentRow?.display_name ?? agentId} (${agentRole})`]);
        json(res, 200, { success: true, deleted: true });
      } else {
        // Soft-delete (retire)
        const [agentRow] = await systemQuery<{ id: string; role: string }>(
          'SELECT id::text AS id, role FROM company_agents WHERE id::text=$1 OR role=$1 LIMIT 1',
          [agentId],
        );
        if (!agentRow) {
          json(res, 404, { error: 'Agent not found' });
          return;
        }

        const nowIso = new Date().toISOString();
        await systemQuery(
          'UPDATE company_agents SET status=$1, updated_at=$2 WHERE id::text=$3 OR role=$3',
          ['retired', nowIso, agentId],
        );
        await systemQuery(
          'UPDATE agent_schedules SET enabled=$1 WHERE agent_id=$2 OR agent_id=$3',
          [false, agentRow.id, agentRow.role],
        );
        json(res, 200, { success: true });
      }
      return;
    }

    // ─── Analysis Engine Endpoints (v1 → Strategy Lab v2 redirect) ────

    // Launch analysis — redirects to Strategy Lab v2 engine
    if (method === 'POST' && url === '/analysis/run') {
      if (!isLiveRuntimeRole('vp-research')) {
        json(res, 409, { error: 'Strategy analysis is unavailable because the research lead role is not on the live roster.' });
        return;
      }
      const body = JSON.parse(await readBody(req));
      const { type, query, requestedBy } = body;
      const id = await strategyLabEngine.launch({
        query,
        analysisType: (type as StrategyAnalysisType) || 'competitive_landscape',
        depth: 'deep',
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
          ...corsHeadersFor(req),
        });
        res.end(exportAnalysisJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportAnalysisPPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="analysis-${id}.pptx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportAnalysisDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="analysis-${id}.docx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="analysis-${id}.md"`,
          ...corsHeadersFor(req),
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
      const imageResponse = await strategyModelClient.generateImageOpenAI(prompt, 'gpt-image-1.5');

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
          ...corsHeadersFor(req),
        });
        res.end(exportSimulationJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportSimulationPPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="simulation-${id}.pptx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportSimulationDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="simulation-${id}.docx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="simulation-${id}.md"`,
          ...corsHeadersFor(req),
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
          ...corsHeadersFor(req),
        });
        res.end(exportCotJSON(record));
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="cot-${id}.md"`,
          ...corsHeadersFor(req),
        });
        res.end(exportCotMarkdown(record));
      }
      return;
    }

    // ─── Deep Dive Engine Endpoints ───────────────────────────

    // Launch deep dive
    if (method === 'POST' && url === '/deep-dive/run') {
      if (!isLiveRuntimeRole('vp-research')) {
        json(res, 409, { error: 'Deep dive runs are unavailable because the research lead role is not on the live roster.' });
        return;
      }
      const body = JSON.parse(await readBody(req));
      const { target, context: ddContext, requestedBy } = body;
      if (!target) { json(res, 400, { error: 'target is required' }); return; }
      const deepDiveRequest = {
        target,
        context: ddContext,
        requestedBy: requestedBy ?? 'dashboard',
      };
      const ddId = await deepDiveEngine.create(deepDiveRequest);
      const deepDiveRunId = crypto.randomUUID();
      const deepDiveSessionId = await ensureRuntimeSession({
        sessionKey: `deep-dive:${ddId}`,
        source: 'scheduler-deep-dive',
        ownerUserId: dashboardUser?.uid ?? null,
        ownerEmail: dashboardUser?.email ?? null,
        primaryAgentRole: 'vp-research',
        metadata: {
          deepDiveId: ddId,
          target,
          requestedBy: requestedBy ?? 'dashboard',
          nonChat: true,
        },
        runId: deepDiveRunId,
      });
      const deepDiveAttempt = await createRuntimeAttempt({
        sessionId: deepDiveSessionId,
        runId: deepDiveRunId,
        triggeredBy: 'dashboard-user',
        triggerReason: 'deep_dive_run',
        requestPayload: {
          deepDiveId: ddId,
          target,
          requestedBy: requestedBy ?? 'dashboard',
          nonChat: true,
        },
      });
      let deepDiveParentEventId: string | null = null;
      const persistDeepDiveEvent = async (
        eventType: Parameters<typeof appendRuntimeEvent>[0]['eventType'],
        payload: Record<string, unknown>,
        status?: string,
      ) => {
        const persisted = await appendRuntimeEvent({
          sessionId: deepDiveSessionId,
          attemptId: deepDiveAttempt.id,
          runId: deepDiveRunId,
          eventType,
          status: status ?? null,
          actorRole: 'vp-research',
          payload,
          parentEventId: deepDiveParentEventId,
        });
        deepDiveParentEventId = persisted.eventId;
      };
      await persistDeepDiveEvent('run_created', {
        deepDiveId: ddId,
        target,
        nonChat: true,
      }, 'created');
      await markRuntimeAttemptRunning({ attemptId: deepDiveAttempt.id });
      await persistDeepDiveEvent('run_started', {
        deepDiveId: ddId,
        target,
        nonChat: true,
      }, 'running');
      await persistDeepDiveEvent('turn_started', {
        phase: 'deep_dive_dispatch',
        nonChat: true,
      }, 'running');
      let dispatchMode: 'queued' | 'direct_worker' = 'direct_worker';
      let dispatchWarning: string | null = null;

      if (isWorkerQueueConfigured()) {
        try {
          await enqueueDeepDiveExecution({
            deepDiveId: ddId,
            runId: deepDiveRunId,
            target,
            context: ddContext,
            requestedBy: requestedBy ?? 'dashboard',
          });
          await persistDeepDiveEvent('status', {
            deepDiveId: ddId,
            mode: 'queued',
            phase: 'queued',
            nonChat: true,
          }, 'running');
          dispatchMode = 'queued';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dispatchWarning = `Failed to enqueue deep dive worker task, running inline fallback: ${message}`;
          console.warn('[DeepDive] Queue dispatch failed, using inline fallback:', message);

          await persistDeepDiveEvent('status', {
            deepDiveId: ddId,
            mode: 'inline-fallback-worker-dispatch',
            phase: 'dispatch_retry',
            warning: message,
            nonChat: true,
          }, 'running');
          try {
            await executeWorkerDeepDiveExecution({
              deepDiveId: ddId,
              runId: deepDiveRunId,
              target,
              context: ddContext,
              requestedBy: requestedBy ?? 'dashboard',
            });
            dispatchMode = 'direct_worker';
          } catch (inlineDispatchError) {
            const msg = inlineDispatchError instanceof Error ? inlineDispatchError.message : String(inlineDispatchError);
            await persistDeepDiveEvent('run_failed', {
              deepDiveId: ddId,
              error: msg,
              nonChat: true,
            }, 'failed');
            await markRuntimeAttemptTerminal({
              attemptId: deepDiveAttempt.id,
              status: 'failed',
              responseSummary: { dispatch: 'failed', mode: 'inline-worker-dispatch' },
              errorMessage: msg,
            });
            await markRuntimeSessionTerminal({
              sessionId: deepDiveSessionId,
              status: 'failed',
            });
            try { await deepDiveEngine.markError(ddId, `Worker dispatch failed: ${msg}`); } catch { /* best effort */ }
            throw inlineDispatchError;
          }
        }
      } else {
        dispatchWarning = 'Deep dive worker queue is not configured; dispatching directly to worker.';
        console.warn('[DeepDive] Worker queue not configured, dispatching directly to worker.');
        await persistDeepDiveEvent('status', {
          deepDiveId: ddId,
          mode: 'direct-worker-dispatch',
          phase: 'dispatch',
          nonChat: true,
        }, 'running');
        try {
          await executeWorkerDeepDiveExecution({
            deepDiveId: ddId,
            runId: deepDiveRunId,
            target,
            context: ddContext,
            requestedBy: requestedBy ?? 'dashboard',
          });
          dispatchMode = 'direct_worker';
        } catch (directDispatchError) {
          const msg = directDispatchError instanceof Error ? directDispatchError.message : String(directDispatchError);
          await persistDeepDiveEvent('run_failed', {
            deepDiveId: ddId,
            error: msg,
            nonChat: true,
          }, 'failed');
          await markRuntimeAttemptTerminal({
            attemptId: deepDiveAttempt.id,
            status: 'failed',
            responseSummary: { dispatch: 'failed', mode: 'direct-worker-dispatch' },
            errorMessage: msg,
          });
          await markRuntimeSessionTerminal({
            sessionId: deepDiveSessionId,
            status: 'failed',
          });
          try { await deepDiveEngine.markError(ddId, `Worker dispatch failed: ${msg}`); } catch { /* best effort */ }
          throw directDispatchError;
        }
      }

      await persistDeepDiveEvent('result', {
        deepDiveId: ddId,
        dispatchMode,
        warning: dispatchWarning,
        nonChat: true,
      }, 'completed');
      await persistDeepDiveEvent('run_completed', {
        deepDiveId: ddId,
        dispatchMode,
        nonChat: true,
      }, 'completed');
      await markRuntimeAttemptTerminal({
        attemptId: deepDiveAttempt.id,
        status: 'completed',
        responseSummary: {
          dispatchMode,
          warning: dispatchWarning,
        },
      });
      await markRuntimeSessionTerminal({
        sessionId: deepDiveSessionId,
        status: 'completed',
      });

      json(res, 200, {
        success: true,
        id: ddId,
        run_id: deepDiveRunId,
        dispatch_mode: dispatchMode,
        warning: dispatchWarning,
      });
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
          ...corsHeadersFor(req),
        });
        res.end(exportDeepDiveJSON(record));
      } else if (format === 'pptx') {
        const buffer = await exportDeepDivePPTX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.pptx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportDeepDiveDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.docx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="deep-dive-${ddId}.md"`,
          ...corsHeadersFor(req),
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
      const imageResponse = await strategyModelClient.generateImageOpenAI(prompt, 'gpt-image-1.5');

      // Apply logo watermark and save to DB
      const watermarked = await applyWatermark(imageResponse.imageData);
      await systemQuery('UPDATE deep_dives SET visual_image=$1 WHERE id=$2', [watermarked, ddId]);

      json(res, 200, { image: watermarked, mimeType: 'image/png' });
      return;
    }

    // ─── Strategy Lab v2 Endpoints ──────────────────────────────

    // Launch a strategy analysis
    if (method === 'POST' && url === '/strategy-lab/run') {
      if (!isLiveRuntimeRole('vp-research')) {
        json(res, 409, { error: 'Strategy Lab runs are unavailable because the research lead role is not on the live roster.' });
        return;
      }
      const body = JSON.parse(await readBody(req));
      const { query, analysisType, requestedBy } = body;
      if (!query) { json(res, 400, { error: 'query is required' }); return; }
      const id = await strategyLabEngine.launch({
        query,
        analysisType: analysisType || 'competitive_landscape',
        depth: 'deep',
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
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else if (format === 'docx') {
        const buffer = await exportStrategyLabDOCX(record);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="strategy-${id}.docx"`,
          ...corsHeadersFor(req),
        });
        res.end(buffer);
      } else {
        // Markdown export
        const md = exportStrategyLabMarkdown(record);
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="strategy-${id}.md"`,
          ...corsHeadersFor(req),
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
        const stored = saRow.visual_image.trim();
        const dataUriMatch = stored.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (dataUriMatch) {
          json(res, 200, { image: dataUriMatch[2], mimeType: dataUriMatch[1] });
        } else {
          json(res, 200, { image: stored, mimeType: 'image/png' });
        }
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

      let imageB64: string;
      let mimeType: 'image/png' = 'image/png';
      let fallbackUsed = false;
      let fallbackReason: string | null = null;
      const useAiVisual = process.env.STRATEGY_VISUAL_USE_AI === 'true';
      if (useAiVisual) {
        try {
          const prompt = buildStrategyLabVisualPrompt(record);
          const imageResponse = await strategyModelClient.generateImageOpenAI(prompt, 'gpt-image-1.5');
          imageB64 = await applyWatermark(imageResponse.imageData);
        } catch (error) {
          fallbackUsed = true;
          fallbackReason = (error as Error).message;
          console.warn('[StrategyLabVisual] AI image generation failed, using deterministic fallback visual:', fallbackReason);
          imageB64 = await buildStrategyFallbackVisualPng(record);
        }
      } else {
        fallbackUsed = true;
        fallbackReason = 'AI visual generation disabled; deterministic infographic mode active';
        imageB64 = await buildStrategyFallbackVisualPng(record);
      }

      await systemQuery('UPDATE strategy_analyses SET visual_image=$1 WHERE id=$2', [imageB64, id]);

      json(res, 200, { image: imageB64, mimeType, fallbackUsed, fallbackReason });
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
          'INSERT INTO founder_directives (title, description, priority, category, target_agents, due_date, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [body.title, body.description, body.priority || 'high', body.category || 'general', body.target_agents || [], body.due_date || null, body.created_by || 'kristina', '00000000-0000-0000-0000-000000000000'],
        );
        // Invalidate directive/context caches
        getRedisCache().invalidatePattern('jit:directives:*').catch(() => {});

        // Queue a wake for CoS so the directive is picked up on the next heartbeat (~10 min)
        try {
          await systemQuery(
            'INSERT INTO agent_wake_queue (agent_role, task, reason, context, status) VALUES ($1,$2,$3,$4,$5)',
            ['chief-of-staff', 'orchestrate', 'new_directive_created', JSON.stringify({ directive_id: data.id, title: data.title, priority: data.priority }), 'pending'],
          );
        } catch { /* wake queue is best-effort */ }

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

    // ── Quick Assign — direct founder-to-agent tracked assignment ──────
    if (method === 'POST' && url === '/quick-assign') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole as string | undefined;
      const taskDescription = body.taskDescription as string | undefined;
      const priority = (body.priority as string) || 'normal';
      const expectedOutput = (body.expectedOutput as string) || null;
      const assignedBy = (body.assignedBy as string) || 'founder';

      if (!agentRole || !taskDescription) {
        json(res, 400, { error: 'agentRole and taskDescription are required' });
        return;
      }

      // Validate priority
      if (!['urgent', 'high', 'normal', 'low'].includes(priority)) {
        json(res, 400, { error: 'priority must be urgent, high, normal, or low' });
        return;
      }

      // Validate agent exists and is active
      if (!isLiveRuntimeRole(agentRole)) {
        json(res, 404, { error: `Agent "${agentRole}" is not on the live runtime roster` });
        return;
      }

      const [agent] = await systemQuery(
        "SELECT role FROM company_agents WHERE role = $1 AND status = 'active'",
        [agentRole],
      );
      if (!agent) {
        json(res, 404, { error: `Agent "${agentRole}" not found or not active` });
        return;
      }

      const guard = await assertWorkAssignmentDispatchAllowed({
        taskDescription: taskDescription,
        assignedTo: agentRole,
      });
      if (!guard.ok) {
        json(res, 409, { error: guard.error });
        return;
      }

      try {
        // 1. Create tracked work_assignment (no directive)
        const [assignment] = await systemQuery(
          `INSERT INTO work_assignments
            (assigned_to, assigned_by, task_description, task_type, expected_output, priority, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, assigned_to, status, priority, created_at`,
          [agentRole, assignedBy, taskDescription, 'on_demand', expectedOutput, priority, 'pending'],
        );

        await issueContract({
          requestingAgentId: assignedBy,
          requestingAgentName: assignedBy,
          receivingAgentId: agentRole,
          receivingAgentName: agentRole,
          taskId: assignment.id,
          taskDescription,
          requiredInputs: buildRequiredInputs([
            { key: 'taskDescription', type: 'string', value: taskDescription },
            { key: 'expectedOutput', type: 'string', value: expectedOutput },
            { key: 'priority', type: 'string', value: priority },
          ]),
          expectedOutputSchema: buildDefaultExpectedOutputSchema(expectedOutput ?? taskDescription),
          confidenceThreshold: 0.7,
          escalationPolicy: 'return_to_issuer',
        });

        // 2. Wake the agent so they pick it up on next heartbeat
        await systemQuery(
          'INSERT INTO agent_wake_queue (agent_role, task, reason, context, status) VALUES ($1,$2,$3,$4,$5)',
          [agentRole, 'work_loop', 'quick_assign', JSON.stringify({ assignment_id: assignment.id }), 'pending'],
        );

        console.log(`[QuickAssign] Created assignment ${assignment.id} for ${agentRole} (priority: ${priority}, by: ${assignedBy})`);
        json(res, 201, assignment);
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
        let query = `SELECT w.id, w.workflow_type AS type, w.status, w.initiator_role AS initiator,
          fd.title AS directive_title, w.current_step_index AS current_step, w.total_steps,
          w.waiting_for, w.started_at, w.completed_at, w.error
          FROM workflows w
          LEFT JOIN founder_directives fd ON w.directive_id = fd.id`;
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (status) { conditions.push(`w.status=$${conditions.length + 1}`); values.push(status); }
        if (type) { conditions.push(`w.workflow_type=$${conditions.length + 1}`); values.push(type); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY w.started_at DESC LIMIT 50';
        const rows = await systemQuery(query, values);

        // Fetch steps for returned workflows
        const wfIds = rows.map((r: Record<string, unknown>) => r.id);
        const stepsMap: Record<string, Array<Record<string, unknown>>> = {};
        if (wfIds.length > 0) {
          const stepRows = await systemQuery(
            `SELECT workflow_id, id, step_type AS type, status, started_at, completed_at,
              duration_ms, cost_usd, error, step_config
              FROM workflow_steps WHERE workflow_id = ANY($1) ORDER BY step_index`,
            [wfIds],
          );
          for (const s of stepRows as Array<Record<string, unknown>>) {
            const wfId = s.workflow_id as string;
            if (!stepsMap[wfId]) stepsMap[wfId] = [];
            stepsMap[wfId].push({
              id: s.id,
              type: s.type,
              agents: (s.step_config as Record<string, unknown>)?.agents ?? [],
              status: s.status,
              started_at: s.started_at,
              completed_at: s.completed_at,
              duration_ms: s.duration_ms,
              cost_usd: s.cost_usd != null ? Number(s.cost_usd) : null,
              error: s.error,
            });
          }
        }

        const result = rows.map((w: Record<string, unknown>) => {
          const steps = stepsMap[w.id as string] ?? [];
          const totalCost = steps.reduce((sum, s) => sum + (Number(s.cost_usd) || 0), 0);
          return {
            ...w,
            steps,
            total_steps: w.total_steps ?? steps.length,
            total_cost_usd: totalCost,
          };
        });

        json(res, 200, result);
      } catch (error) {
        json(res, 500, { error: (error as Error).message });
      }
      return;
    }

    // Workflow metrics (30-day summary)
    if (method === 'GET' && url === '/workflows/metrics') {
      try {
        const days = Math.min(Math.max(parseInt(params.get('days') ?? '30', 10) || 30, 1), 365);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();

        const [summary] = await systemQuery(
          `SELECT
            COUNT(*) AS total_started,
            COUNT(*) FILTER (WHERE status = 'completed') AS total_completed,
            COUNT(*) FILTER (WHERE status = 'failed') AS total_failed,
            COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
              FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL), 0) AS avg_completion_time_ms
          FROM workflows WHERE started_at >= $1`,
          [since],
        );

        const byType = await systemQuery(
          `SELECT w.workflow_type AS type, COUNT(*) AS count,
            COALESCE(AVG(EXTRACT(EPOCH FROM (w.completed_at - w.started_at)) * 1000)
              FILTER (WHERE w.completed_at IS NOT NULL), 0) AS avg_time_ms,
            COALESCE(AVG(COALESCE(s.total_cost, 0)), 0) AS avg_cost
          FROM workflows w
          LEFT JOIN (
            SELECT workflow_id, SUM(cost_usd) AS total_cost FROM workflow_steps GROUP BY workflow_id
          ) s ON s.workflow_id = w.id
          WHERE w.started_at >= $1
          GROUP BY w.workflow_type
          ORDER BY count DESC`,
          [since],
        );

        json(res, 200, {
          total_started: Number(summary.total_started),
          total_completed: Number(summary.total_completed),
          total_failed: Number(summary.total_failed),
          avg_completion_time_ms: Math.round(Number(summary.avg_completion_time_ms)),
          by_type: byType.map((t: Record<string, unknown>) => ({
            type: t.type,
            count: Number(t.count),
            avg_time_ms: Math.round(Number(t.avg_time_ms)),
            avg_cost: Number(Number(t.avg_cost).toFixed(4)),
          })),
        });
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
      if (!(await requireDashboardUser(req, res))) return;
      await handleTriangulatedChat(req, res, {
        modelClient: strategyModelClient,
        embeddingClient: { embed: async (_text: string) => [] as number[] },
        redisCache: getRedisCache(),
      });
      return;
    }

    // ── Eval Dashboard API (/api/eval/*) ──────────────────────────
    if (url.startsWith('/api/eval/')) {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
    }
    if (await handleEvalApi(req, res, url, queryString ?? '', method)) return;

    // ── Governance API (/api/governance/*) ────────────────────────
    if (url.startsWith('/api/governance/')) {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
    }
    if (await handleGovernanceApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin ABAC API (/admin/abac/*) ────────────────────────────
    if (
      url.startsWith('/admin/')
      && !(url.startsWith('/admin/metrics') && method === 'GET')
      && !isAdminViewerReadableGet(url, method)
    ) {
      if (!(await requireDashboardUser(req, res, { admin: true }))) return;
    }
    if (await handleAbacAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Autonomy API (/admin/autonomy/*) ────────────────────
    if (await handleAutonomyAdminApi(req, res, url, queryString ?? '', method, agentNotifier)) return;

    // ── Admin Capacity API (/admin/agents/*, /admin/commitments/*) ─
    if (await handleCapacityAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Contradictions API (/admin/contradictions/*) ────────
    if (await contradictionAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Department Activation API (/admin/departments/*) ────
    if (await handleDepartmentAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Disclosure API (/admin/agents/*, /admin/disclosure/*) ──
    if (await handleDisclosureAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Handoff Contract API (/admin/contracts/*, /admin/agents/:id/contracts) ──
    if (await handleHandoffContractAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Decision Trace API (/admin/decisions/*, /admin/agents/:id/decisions) ──
    if (await handleDecisionTraceAdminApi(req, res, url, queryString ?? '', method, { modelClient: strategyModelClient })) return;

    // ── Admin Metrics API (/admin/metrics/*) ───────────────────
    if (await handleMetricsAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin Temporal KG API (/admin/kg/*) ─────────────────────
    if (await handleTemporalKnowledgeGraphAdminApi(req, res, url, queryString ?? '', method)) return;

    // ── Dashboard CRUD API (/api/*) ────────────────────────────────
    if (url.startsWith('/api/')) {
      if (!dashboardUser) {
        json(res, 403, { error: 'Forbidden' });
        return;
      }
      if (await handleDashboardApi(req, res, url, queryString ?? '', method, dashboardUser)) return;
    }

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
    `Overall style: clean, data-rich, executive-ready slide, with clear section headings, consistent iconography, and sufficient whitespace for readability.`,
    ``,
    `Color palette: primary cyan (#00E0FF), white (#FFFFFF) background, dark charcoal (#1A1A2E) text, emerald (#34D399) for positive, rose (#FB7185) for negative, amber (#FBBF24) for caution. Use thin black (#1A1A2E) borders on all cards and sections. Footer bar should be black with white text.`,
    ``,
    `LAYOUT (3 rows):`,
    ``,
    `ROW 1 — Header (8% height):`,
    `Full-width solid black (#000000) bar with bold white sans-serif title: "${r.targetName.toUpperCase()} — DEEP DIVE", left-aligned with comfortable padding. Leave the top-right corner empty — a logo will be composited there after generation. Do NOT render any icon, logo, wordmark, date, or secondary text in the header.`,
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
    `Reserve a clean footer-safe zone across the bottom of the image for a system-applied footer overlay. Do not render any copyright line, footer bar, or logo inside the image content. Also leave the top-right corner of the header clear for a system-applied logo overlay.`,
    ``,
    `CRITICAL RULES:`,
    `- MINIMAL TEXT. Maximum 35 words total on the infographic (excluding title).`,
    `- Use icons, shapes, charts, numbers, and color to convey information.`,
    `- No sentences, no paragraphs, no bullet-point lists.`,
    `- All text must be crisp, readable sans-serif.`,
    `- Professional, clean, corporate aesthetic.`,
    `- Do NOT render any logo, icon, wordmark, or company branding — branding is applied after generation.`,
  ].join('\n');
}

/* ── Strategy Lab v2 Markdown Export ─────────────── */

function exportStrategyLabMarkdown(record: import('./strategyLabEngine.js').StrategyAnalysisRecord): string {
  const s = record.synthesis;
  if (!s) return `# Strategy Analysis: ${record.query}\n\n_Analysis not yet completed._`;

  const lines: string[] = [
    `# Strategy Analysis: ${record.query}`,
    ``,
    `**Type:** ${record.analysis_type} | **Sources:** ${record.total_sources} | **Searches:** ${record.total_searches}`,
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

async function startServer(): Promise<void> {
  const modelValidationMode = (process.env.MODEL_VALIDATION_ENFORCEMENT ?? 'warn').toLowerCase();
  const strictModelValidation = modelValidationMode === 'strict';

  server.listen(PORT, () => {
    console.log(`[Scheduler] Listening on port ${PORT}`);

    // Validate model config after binding the Cloud Run port so startup probes succeed.
    validateModelConfig()
      .then((modelValidation) => {
        if (!modelValidation.passed) {
          console.error(
            `[Startup] Model config validation failed with ${modelValidation.errors.length} error(s). ` +
            `mode=${strictModelValidation ? 'strict' : 'warn'}.`,
          );
          if (strictModelValidation) {
            console.error('[Startup] Strict model validation is enabled; shutting down scheduler.');
            process.exit(1);
          }
        }
      })
      .catch((err) => {
        console.error('[Startup] Model validation check failed to execute:', (err as Error).message);
        if (strictModelValidation) {
          process.exit(1);
        }
      });

    ensureAgentRunsRoutingSchema().catch((err) =>
      console.warn('[Scheduler] Startup schema compatibility check failed:', (err as Error).message),
    );

    ensureDecisionApprovalsSchema().catch((err) =>
      console.warn('[Scheduler] Decision approval schema compatibility check failed:', (err as Error).message),
    );

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

    handoffContractMonitor.start();
  });
}

startServer().catch((err) => {
  console.error('[Scheduler] Fatal startup validation error:', (err as Error).message);
  process.exit(1);
});

// ─── Graceful shutdown ──────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Scheduler] SIGTERM received, shutting down gracefully...');
  try {
    chatSubscriptionManager?.stopAutoRenewal();
    graphChatHandler?.destroy();
  } catch { /* best-effort */ }
  try {
    handoffContractMonitor.stop();
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

