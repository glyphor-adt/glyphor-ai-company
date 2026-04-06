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
} from '@glyphor/agent-runtime';
import type { CompanyAgentRole, AgentExecutionResult, GlyphorEvent, ConversationTurn, ConversationAttachment, WorkflowStatus } from '@glyphor/agent-runtime';
import { handleStripeWebhook, syncStripeAll, syncBillingToDB, syncMercuryAll, syncOpenAIBilling, syncAnthropicBilling, syncKlingBilling, syncSharePointKnowledge, type KlingCredentials, runGovernanceSync, GraphChatHandler, ChatSubscriptionManager, GraphTeamsClient, getM365Token, A365TeamsChatClient, handleDocuSignWebhook } from '@glyphor/integrations';
import { SYSTEM_PROMPTS } from '@glyphor/agents';
import { assertWorkAssignmentDispatchAllowed, getTierModel } from '@glyphor/shared';
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
import { runEconomicsGuardrailNotify } from './economicsGuardrailNotify.js';
import { handleDashboardApi } from './dashboardApi.js';
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
import { handlePlatformIntelApproval } from './platformIntelApproval.js';
import { handleDirectiveApproval } from './directiveApproval.js';
import { expireTools } from './toolExpirationManager.js';
import { evaluateCanary } from './canaryEvaluator.js';
import { evaluateAgentKnowledgeGaps } from './agentKnowledgeEvaluator.js';
import { runGtmReadinessEval, persistGtmReport } from './gtmReadiness/index.js';
import { evaluatePlanningGateHealth } from './planningGateMonitor.js';
import { handleTriangulatedChat } from './triangulationEndpoint.js';
import { enqueueDeepDiveExecution, isWorkerQueueConfigured } from './workerQueue.js';
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
import {
  runChiefOfStaff, runCTO, runCFO, runCLO, runCPO, runCMO, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runUiUxDesigner, runFrontendEngineer, runDesignCritic, runTemplateArchitect,
  runM365Admin,
  runGlobalAdmin,
  runHeadOfHR,
  runOps,
  runCompetitiveResearchAnalyst,
  runMarketResearchAnalyst,
  runVPResearch,
  runDynamicAgent,
  runPlatformIntel,
} from '@glyphor/agents';
import { OAuth2Client } from 'google-auth-library';

const PORT = parseInt(process.env.PORT || '8080', 10);
const oidcClient = new OAuth2Client();

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

async function requireInternalAuth(
  req: IncomingMessage,
  res: ServerResponse,
  endpointPath: string,
): Promise<boolean> {
  const authorization = getHeaderString(req.headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    json(res, 401, { ok: false, error: 'Bearer token required' });
    return false;
  }

  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) {
    json(res, 401, { ok: false, error: 'Missing bearer token' });
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
    json(res, 401, { ok: false, error: 'Unauthorized' });
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
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }

  const expectedServiceAccount = process.env.SCHEDULER_OIDC_SERVICE_ACCOUNT_EMAIL?.trim();
  if (expectedServiceAccount && verifiedEmail && verifiedEmail !== expectedServiceAccount) {
    console.warn(
      `[InternalAuth] OIDC principal mismatch. expected=${expectedServiceAccount} actual=${verifiedEmail}`,
    );
    json(res, 403, { ok: false, error: 'Forbidden' });
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

const agentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  const normalizedTask = task === 'read_inbox' ? 'agent365_mail_triage' : task;
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
    return runCTO({ task: (task as 'platform_health_check' | 'dependency_review' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'cfo') {
    return runCFO({ task: (task as 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'clo') {
    return runCLO({ task: (normalizedTask as 'regulatory_scan' | 'contract_review' | 'compliance_check' | 'agent365_mail_triage' | 'on_demand'), message, conversationHistory });
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
  // Marketing
  else if (agentRole === 'content-creator') {
    return runContentCreator({ task: (task as 'blog_draft' | 'social_batch' | 'performance_review' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'seo-analyst') {
    return runSeoAnalyst({ task: (task as 'ranking_report' | 'keyword_research' | 'competitor_gap' | 'on_demand'), message, conversationHistory });
  } else if (agentRole === 'social-media-manager') {
    return runSocialMediaManager({ task: (task as 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand'), message, conversationHistory });
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
    return runM365Admin({ task: (normalizedTask as 'channel_audit' | 'user_audit' | 'agent365_mail_triage' | 'on_demand'), message, conversationHistory });
  }
  // Global Admin
  else if (agentRole === 'global-admin') {
    return runGlobalAdmin({ task: (normalizedTask as 'access_audit' | 'compliance_report' | 'onboarding' | 'agent365_mail_triage' | 'on_demand'), message, conversationHistory });
  }
  // People & Culture
  else if (agentRole === 'head-of-hr') {
    return runHeadOfHR({ task: (normalizedTask as 'workforce_audit' | 'onboard_agent' | 'retire_agent' | 'agent365_mail_triage' | 'on_demand'), message, conversationHistory });
  }
  // Operations
  else if (agentRole === 'ops') {
    return runOps({ task: (task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'contradiction_detection' | 'knowledge_hygiene'), message, eventPayload: payload, conversationHistory });
  }
  // Platform Intelligence
  else if (agentRole === 'platform-intel') {
    return runPlatformIntel({
      task: (task as 'daily_analysis' | 'on_demand' | 'watch_tool_gaps' | 'memory_consolidation'),
      message,
      conversationHistory,
    });
  }
  // Strategy Lab v2 — Research Analysts
  else if (agentRole === 'vp-research') {
    return runVPResearch({ task: (task as 'decompose_research' | 'qc_and_package_research' | 'follow_up_research' | 'on_demand'), message, analysisId: payload.analysisId as string | undefined, query: payload.query as string | undefined, analysisType: payload.analysisType as string | undefined, depth: payload.depth as string | undefined, sarahNotes: payload.sarahNotes as string | undefined, rawPackets: payload.rawPackets as Record<string, unknown> | undefined, executiveRouting: payload.executiveRouting as Record<string, string[]> | undefined, gaps: payload.gaps as unknown[] | undefined, conversationHistory });
  } else if (agentRole === 'competitive-research-analyst') {
    return runCompetitiveResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else if (agentRole === 'market-research-analyst') {
    return runMarketResearchAnalyst({ task: (task as 'research' | 'on_demand'), message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
  } else {
    // Dynamic agent — look up in DB and run with generic runner
    console.log(`[Scheduler] Agent ${agentRole} not in static roster, trying dynamic runner...`);
    return runDynamicAgent({ role: agentRole, task, message, conversationHistory });
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
  clo: 'legal',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'vp-research': 'research',
  ops: 'operations',
  'platform-intel': 'operations',
  'global-admin': 'operations',
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

  console.log(`[Teams Onboarding] Bot installed: tenant=${teamsTenantId} team=${teamsTeamId ?? 'personal'} installer=${installerAadId ?? 'unknown'}`);

  // Upsert customer_tenants row
  const rows = await systemQuery<{ id: string; settings: Record<string, unknown> }>(
    `INSERT INTO customer_tenants
       (tenant_id, teams_tenant_id, teams_team_id, teams_installer_aad_id,
        teams_service_url, teams_conversation_id, platform, status, installed_by)
     VALUES (
       (SELECT id FROM tenants LIMIT 1),
       $1, $2, $3, $4, $5, 'teams', 'active', 'teams_install'
     )
     ON CONFLICT (teams_tenant_id, teams_team_id)
       WHERE teams_tenant_id IS NOT NULL
     DO UPDATE
       SET teams_installer_aad_id = COALESCE(EXCLUDED.teams_installer_aad_id, customer_tenants.teams_installer_aad_id),
           teams_service_url      = COALESCE(EXCLUDED.teams_service_url, customer_tenants.teams_service_url),
           teams_conversation_id  = COALESCE(EXCLUDED.teams_conversation_id, customer_tenants.teams_conversation_id),
           status                 = 'active',
           updated_at             = NOW()
     RETURNING id, settings`,
    [teamsTenantId, teamsTeamId, installerAadId, serviceUrl, conversationId],
  );

  const customerTenant = rows[0];
  if (!customerTenant) {
    console.error('[Teams Onboarding] Failed to upsert customer_tenants row');
    return;
  }

  // If onboarding is already complete, send a welcome-back message
  if (customerTenant.settings?.['onboarding_complete']) {
    await context.sendActivity('Welcome back! Glyphor is reconnected to this workspace.');
    return;
  }

  // Start the onboarding questionnaire
  await context.sendActivity(
    "Hi \u2014 I'm Maya, your CMO. Before I get started, I have a few quick questions " +
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
  const inputMsg = typeof payload?.message === 'string' ? payload.message : null;
  const startMs = Date.now();
  const requestedRunId = typeof payload?.runId === 'string' && UUID_RE.test(payload.runId.trim())
    ? payload.runId.trim()
    : null;

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
    const result = await agentExecutor(agentRole, task, runId ? { ...payload, runId } : payload);
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

      // Reactive wake: notify platform-intel of agent failures/aborts
      if ((runStatus === 'failed' || runStatus === 'aborted') && agentRole !== 'platform-intel') {
        wakeRouter.processEvent({
          type: 'agent.run_failed',
          data: { agent_role: agentRole, task, run_id: runId, status: runStatus, error: result?.error ?? result?.abortReason ?? null },
          source: 'scheduler',
        }).catch(() => {});
      }
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
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
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

    // Platform Intel approval/rejection webhooks (GET from Teams card links)
    if (method === 'GET' && url?.startsWith('/platform-intel/')) {
      const handled = await handlePlatformIntelApproval(url, req, res);
      if (handled) return;
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

      // Reactive wake: notify CLO and relevant agents of DocuSign events
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
              'clo',
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

    // Tool health tests (called by Cron or Dashboard)
    if (method === 'POST' && url === '/tool-health/run') {
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
      const authed = await requireInternalAuth(req, res, '/internal/model-check');
      if (!authed) return;
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

    // OpenAI billing sync endpoint — syncs per-product keys
    if (method === 'POST' && url === '/sync/openai-billing') {
      try {
        const webBuildEnv = 'OPENAI_ADMIN_KEY_WEB_BUILD';
        const legacyWebBuildEnv = `OPENAI_ADMIN_KEY_${'FU' + 'SE'}`;
        const productKeys: Array<{ product: string; key: string }> = [];
        // Per-product keys: legacy web-build, pulse, company
        if (process.env[webBuildEnv]) productKeys.push({ product: 'web-build', key: process.env[webBuildEnv] });
        if (process.env[legacyWebBuildEnv]) productKeys.push({ product: 'web-build', key: process.env[legacyWebBuildEnv] });
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
        const webBuildEnv = 'ANTHROPIC_ADMIN_KEY_WEB_BUILD';
        const legacyWebBuildEnv = `ANTHROPIC_ADMIN_KEY_${'FU' + 'SE'}`;
        const productKeys: Array<{ product: string; key: string }> = [];
        // Per-product keys: legacy web-build, pulse, company
        if (process.env[webBuildEnv]) productKeys.push({ product: 'web-build', key: process.env[webBuildEnv] });
        if (process.env[legacyWebBuildEnv]) productKeys.push({ product: 'web-build', key: process.env[legacyWebBuildEnv] });
        if (process.env.ANTHROPIC_ADMIN_KEY_PULSE) productKeys.push({ product: 'pulse', key: process.env.ANTHROPIC_ADMIN_KEY_PULSE });
        if (process.env.ANTHROPIC_ADMIN_KEY_COMPANY) productKeys.push({ product: 'glyphor-ai-company', key: process.env.ANTHROPIC_ADMIN_KEY_COMPANY });
        // Fallback: single key defaults to 'glyphor-ai-company'
        if (productKeys.length === 0) {
          const fallback = process.env.ANTHROPIC_ADMIN_KEY ?? process.env.ANTHROPIC_API_KEY;
          if (fallback) productKeys.push({ product: 'glyphor-ai-company', key: fallback });
        }
        if (productKeys.length === 0) throw new Error('No Anthropic admin billing keys configured');

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
                const dreamResult = await trackedAgentExecutor('platform-intel', 'memory_consolidation', {
                  message: dreamMessage,
                });
                completed = dreamResult?.status === 'completed';
                fleetMemoryDream = {
                  status: dreamResult?.status ?? 'unknown',
                  detail: dreamResult?.resultSummary ?? dreamResult?.error ?? dreamResult?.abortReason ?? undefined,
                  output: dreamResult?.output ?? null,
                };
                if (completed) {
                  await markMemoryConsolidationSuccess();
                }
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

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole ?? body.agent;
      const requestRunId = typeof body.runId === 'string' && body.runId.trim().length > 0
        ? body.runId.trim()
        : crypto.randomUUID();

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
      const hasDbRunCarrier = conversationHistory.some(
        (turn) => typeof turn.content === 'string' && turn.content.startsWith(DB_RUN_ID_TURN_PREFIX),
      );
      if (!hasDbRunCarrier) {
        conversationHistory.unshift({
          role: 'user',
          content: `${DB_RUN_ID_TURN_PREFIX}${requestRunId}`,
          timestamp: Date.now(),
        });
      }

      const result = await router.route({
        source: 'manual',
        agentRole,
        task: body.task,
        payload: {
          ...(body.payload ?? {}),
          runId: requestRunId,
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
        if (result.error) {
          await failContractForTask(
            assignmentId,
            agentRole,
            result.error,
            {
              output: result.output ?? result.error,
              assignmentId,
              submittedBy: agentRole,
              status: 'failed',
            },
          );
        } else {
          await completeContractForTask(
            assignmentId,
            agentRole,
            {
              output: result.output ?? 'No output captured',
              assignmentId,
              submittedBy: agentRole,
              status: 'completed',
            },
            1,
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
      const deepDiveRequest = {
        target,
        context: ddContext,
        requestedBy: requestedBy ?? 'dashboard',
      };
      const ddId = await deepDiveEngine.create(deepDiveRequest);
      let dispatchMode: 'queued' | 'inline' = 'inline';
      let dispatchWarning: string | null = null;

      if (isWorkerQueueConfigured()) {
        try {
          await enqueueDeepDiveExecution({
            deepDiveId: ddId,
            target,
            context: ddContext,
            requestedBy: requestedBy ?? 'dashboard',
          });
          dispatchMode = 'queued';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dispatchWarning = `Failed to enqueue deep dive worker task, running inline fallback: ${message}`;
          console.warn('[DeepDive] Queue dispatch failed, using inline fallback:', message);

          void deepDiveEngine.execute(ddId, deepDiveRequest).catch(async (err) => {
            console.error('[DeepDive] Inline fallback run failed after enqueue error:', err);
            const msg = err instanceof Error ? err.message : String(err);
            try { await deepDiveEngine.markError(ddId, `Inline execution failed: ${msg}`); } catch { /* best effort */ }
          });
        }
      } else {
        dispatchWarning = 'Deep dive worker queue is not configured; running inline execution fallback.';
        console.warn('[DeepDive] Worker queue not configured, using inline fallback.');

        void deepDiveEngine.execute(ddId, deepDiveRequest).catch(async (err) => {
          console.error('[DeepDive] Inline fallback run failed after launch:', err);
          const msg = err instanceof Error ? err.message : String(err);
          try { await deepDiveEngine.markError(ddId, `Inline execution failed: ${msg}`); } catch { /* best effort */ }
        });
      }

      json(res, 200, {
        success: true,
        id: ddId,
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
      await handleTriangulatedChat(req, res, {
        modelClient: strategyModelClient,
        embeddingClient: { embed: async (_text: string) => [] as number[] },
        redisCache: getRedisCache(),
      });
      return;
    }

    // ── Eval Dashboard API (/api/eval/*) ──────────────────────────
    if (await handleEvalApi(req, res, url, queryString ?? '', method)) return;

    // ── Governance API (/api/governance/*) ────────────────────────
    if (await handleGovernanceApi(req, res, url, queryString ?? '', method)) return;

    // ── Admin ABAC API (/admin/abac/*) ────────────────────────────
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
