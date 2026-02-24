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
import { GlyphorEventBus, ModelClient, promptCache } from '@glyphor/agent-runtime';
import type { CompanyAgentRole, AgentExecutionResult, GlyphorEvent } from '@glyphor/agent-runtime';
import { handleStripeWebhook, syncStripeAll, syncBillingToSupabase, syncMercuryAll, syncOpenAIBilling, syncAnthropicBilling, syncKlingBilling, type KlingCredentials, TeamsBotHandler, extractBearerToken } from '@glyphor/integrations';
import { SYSTEM_PROMPTS } from '@glyphor/agents';
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
import {
  exportAnalysisMarkdown, exportAnalysisJSON,
  exportAnalysisPPTX, exportAnalysisDOCX,
  exportSimulationMarkdown, exportSimulationJSON,
  exportSimulationPPTX, exportSimulationDOCX,
  exportCotMarkdown, exportCotJSON,
  exportDeepDiveMarkdown, exportDeepDiveJSON,
  exportDeepDiveDOCX, exportDeepDivePPTX,
  buildVisualPrompt,
} from './reportExporter.js';
import { WakeRouter } from './wakeRouter.js';
import { DataSyncScheduler } from './dataSyncScheduler.js';
import { HeartbeatManager } from './heartbeat.js';
import {
  runChiefOfStaff, runCTO, runCFO, runCPO, runCMO, runVPCS, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runRevenueAnalyst, runCostAnalyst,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runOnboardingSpecialist, runSupportTriage,
  runAccountResearch,
  runM365Admin,
  runOps,
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
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
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
    });
  } else if (agentRole === 'cto') {
    return runCTO({ task: (task as 'platform_health_check' | 'dependency_review' | 'on_demand'), message });
  } else if (agentRole === 'cfo') {
    return runCFO({ task: (task as 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand'), message });
  } else if (agentRole === 'cpo') {
    return runCPO({ task: (task as 'weekly_usage_analysis' | 'competitive_scan' | 'on_demand'), message });
  } else if (agentRole === 'cmo') {
    return runCMO({ task: (task as 'weekly_content_planning' | 'generate_content' | 'seo_analysis' | 'on_demand'), message });
  } else if (agentRole === 'vp-customer-success') {
    return runVPCS({ task: (task as 'daily_health_scoring' | 'churn_detection' | 'on_demand'), message });
  } else if (agentRole === 'vp-sales') {
    return runVPSales({ task: (task as 'pipeline_review' | 'market_sizing' | 'on_demand'), message });
  } else if (agentRole === 'vp-design') {
    return runVPDesign({ task: (task as 'design_audit' | 'design_system_review' | 'on_demand'), message });
  }
  // ─── Sub-team agents ────────────────────────────────────────
  // Engineering
  else if (agentRole === 'platform-engineer') {
    return runPlatformEngineer({ task: (task as 'health_check' | 'metrics_report' | 'on_demand'), message });
  } else if (agentRole === 'quality-engineer') {
    return runQualityEngineer({ task: (task as 'qa_report' | 'regression_check' | 'on_demand'), message });
  } else if (agentRole === 'devops-engineer') {
    return runDevOpsEngineer({ task: (task as 'optimization_scan' | 'pipeline_report' | 'on_demand'), message });
  }
  // Product
  else if (agentRole === 'user-researcher') {
    return runUserResearcher({ task: (task as 'cohort_analysis' | 'churn_signals' | 'on_demand'), message });
  } else if (agentRole === 'competitive-intel') {
    return runCompetitiveIntel({ task: (task as 'landscape_scan' | 'deep_dive' | 'on_demand'), message });
  }
  // Finance
  else if (agentRole === 'revenue-analyst') {
    return runRevenueAnalyst({ task: (task as 'revenue_report' | 'forecast' | 'on_demand'), message });
  } else if (agentRole === 'cost-analyst') {
    return runCostAnalyst({ task: (task as 'cost_report' | 'waste_scan' | 'on_demand'), message });
  }
  // Marketing
  else if (agentRole === 'content-creator') {
    return runContentCreator({ task: (task as 'blog_draft' | 'social_batch' | 'performance_review' | 'on_demand'), message });
  } else if (agentRole === 'seo-analyst') {
    return runSeoAnalyst({ task: (task as 'ranking_report' | 'keyword_research' | 'competitor_gap' | 'on_demand'), message });
  } else if (agentRole === 'social-media-manager') {
    return runSocialMediaManager({ task: (task as 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand'), message });
  }
  // Customer Success
  else if (agentRole === 'onboarding-specialist') {
    return runOnboardingSpecialist({ task: (task as 'funnel_report' | 'drop_off_analysis' | 'on_demand'), message });
  } else if (agentRole === 'support-triage') {
    return runSupportTriage({ task: (task as 'triage_queue' | 'batch_analysis' | 'on_demand'), message });
  }
  // Sales
  else if (agentRole === 'account-research') {
    return runAccountResearch({ task: (task as 'prospect_research' | 'batch_enrich' | 'on_demand'), message, company: payload.company as string | undefined });
  }
  // IT / M365
  else if (agentRole === 'm365-admin') {
    return runM365Admin({ task: (task as 'channel_audit' | 'user_audit' | 'on_demand'), message });
  }
  // Operations
  else if (agentRole === 'ops') {
    return runOps({ task: (task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'contradiction_detection' | 'knowledge_hygiene'), message, eventPayload: payload });
  } else {
    console.log(`[Scheduler] Agent ${agentRole} not recognized, skipping task: ${task}`);
  }
};

// Wrap executor to record every run in agent_runs for the Activity dashboard
const trackedAgentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<AgentExecutionResult | void> => {
  const sb = memory.getSupabaseClient();
  const inputMsg = typeof payload?.message === 'string' ? payload.message : null;

  // Insert a "running" row
  const { data: runRow } = await sb
    .from('agent_runs')
    .insert({ agent_id: agentRole, task, status: 'running', input: inputMsg })
    .select('id')
    .single();

  const runId = runRow?.id as string | undefined;
  const startMs = Date.now();

  try {
    const result = await agentExecutor(agentRole, task, payload);
    const durationMs = Date.now() - startMs;

    // Count tool calls from conversation history
    const toolCalls = result?.conversationHistory
      ? result.conversationHistory.filter(t => t.role === 'tool_call').length
      : null;

    if (runId) {
      await sb.from('agent_runs').update({
        status: result?.status === 'completed' ? 'completed' : (result?.status === 'error' ? 'failed' : (result?.status ?? 'completed')),
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        turns: result?.totalTurns ?? null,
        tool_calls: toolCalls,
        output: result?.output ?? null,
        error: result?.error ?? result?.abortReason ?? null,
      }).eq('id', runId);
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);

    if (runId) {
      await sb.from('agent_runs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error: message,
      }).eq('id', runId);
    }

    throw err;
  }
};

const router = new EventRouter(trackedAgentExecutor, decisionQueue);
const wakeRouter = new WakeRouter(memory.getSupabaseClient(), trackedAgentExecutor);
const heartbeatManager = new HeartbeatManager(memory.getSupabaseClient(), trackedAgentExecutor, wakeRouter);

const strategyModelClient = new ModelClient({
  geminiApiKey: process.env.GOOGLE_AI_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});
const analysisEngine = new AnalysisEngine(memory.getSupabaseClient(), strategyModelClient);
const simulationEngine = new SimulationEngine(memory.getSupabaseClient(), strategyModelClient);
const meetingEngine = new MeetingEngine(memory.getSupabaseClient(), trackedAgentExecutor);
const cotEngine = new CotEngine(memory.getSupabaseClient(), strategyModelClient);
const deepDiveEngine = new DeepDiveEngine(memory.getSupabaseClient(), strategyModelClient);

// Teams Bot — initialized from env vars (BOT_APP_ID, BOT_APP_SECRET, BOT_TENANT_ID)
const teamsBot = TeamsBotHandler.fromEnv(
  async (agentRole, task, payload) => {
    const result = await trackedAgentExecutor(agentRole as CompanyAgentRole, task, payload);
    return result ?? undefined;
  },
);

// ─── Glyphor Event Bus ──────────────────────────────────────────

const glyphorEventBus = new GlyphorEventBus({
  supabase: memory.getSupabaseClient(),
});
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
      json(res, 200, { status: 'ok', service: 'glyphor-scheduler' });
      return;
    }

    // Cache invalidation
    if (method === 'POST' && url === '/cache/invalidate') {
      const body = await readBody(req).catch(() => '{}');
      const { prefix } = JSON.parse(body || '{}');
      promptCache.invalidate(prefix);
      json(res, 200, { invalidated: true, prefix: prefix ?? 'all' });
      return;
    }

    // Stripe webhook endpoint
    if (method === 'POST' && url === '/webhook/stripe') {
      const rawBody = await readBody(req);
      const result = await handleStripeWebhook(req, rawBody, memory.getSupabaseClient());

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
        const result = await syncStripeAll(memory.getSupabaseClient());
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          status: 'ok',
          updated_at: new Date().toISOString(),
        }).eq('id', 'stripe');
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'stripe').single();
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_failure_at: new Date().toISOString(),
          last_error: message,
          consecutive_failures: failures,
          status: failures >= 3 ? 'failing' : 'stale',
          updated_at: new Date().toISOString(),
        }).eq('id', 'stripe');
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
        const result = await syncBillingToSupabase(
          memory.getSupabaseClient(), projectId, billingDataset, billingTable,
        );
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          status: 'ok',
          updated_at: new Date().toISOString(),
        }).eq('id', 'gcp-billing');
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'gcp-billing').single();
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_failure_at: new Date().toISOString(),
          last_error: message,
          consecutive_failures: failures,
          status: failures >= 3 ? 'failing' : 'stale',
          updated_at: new Date().toISOString(),
        }).eq('id', 'gcp-billing');
        json(res, 500, { success: false, error: message });
      }
      return;
    }

    // Mercury banking sync endpoint
    if (method === 'POST' && url === '/sync/mercury') {
      try {
        const result = await syncMercuryAll(memory.getSupabaseClient());
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          status: 'ok',
          updated_at: new Date().toISOString(),
        }).eq('id', 'mercury');
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'mercury').single();
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_failure_at: new Date().toISOString(),
          last_error: message,
          consecutive_failures: failures,
          status: failures >= 3 ? 'failing' : 'stale',
          updated_at: new Date().toISOString(),
        }).eq('id', 'mercury');
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
        for (const { product, key } of productKeys) {
          try {
            results[product] = await syncOpenAIBilling(memory.getSupabaseClient(), key, product);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results[product] = { error: msg };
            errors.push(`${product}: ${msg}`);
          }
        }
        const anySuccess = Object.values(results).some((r) => !('error' in r));
        if (anySuccess) {
          await memory.getSupabaseClient().from('data_sync_status').update({
            last_success_at: new Date().toISOString(),
            consecutive_failures: 0,
            status: errors.length > 0 ? 'partial' : 'ok',
            last_error: errors.length > 0 ? errors.join('; ') : null,
            updated_at: new Date().toISOString(),
          }).eq('id', 'openai-billing');
        } else {
          const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'openai-billing').single();
          const failures = (current?.consecutive_failures ?? 0) + 1;
          await memory.getSupabaseClient().from('data_sync_status').update({
            last_failure_at: new Date().toISOString(),
            last_error: errors.join('; '),
            consecutive_failures: failures,
            status: failures >= 3 ? 'failing' : 'stale',
            updated_at: new Date().toISOString(),
          }).eq('id', 'openai-billing');
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
        for (const { product, key } of productKeys) {
          try {
            results[product] = await syncAnthropicBilling(memory.getSupabaseClient(), key, product);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results[product] = { error: msg };
            errors.push(`${product}: ${msg}`);
          }
        }
        const anySuccess = Object.values(results).some((r) => !('error' in r));
        if (anySuccess) {
          await memory.getSupabaseClient().from('data_sync_status').update({
            last_success_at: new Date().toISOString(),
            consecutive_failures: 0,
            status: errors.length > 0 ? 'partial' : 'ok',
            last_error: errors.length > 0 ? errors.join('; ') : null,
            updated_at: new Date().toISOString(),
          }).eq('id', 'anthropic-billing');
        } else {
          const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'anthropic-billing').single();
          const failures = (current?.consecutive_failures ?? 0) + 1;
          await memory.getSupabaseClient().from('data_sync_status').update({
            last_failure_at: new Date().toISOString(),
            last_error: errors.join('; '),
            consecutive_failures: failures,
            status: failures >= 3 ? 'failing' : 'stale',
            updated_at: new Date().toISOString(),
          }).eq('id', 'anthropic-billing');
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
        const result = await syncKlingBilling(memory.getSupabaseClient(), credentials, 'pulse');
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          status: 'ok',
          updated_at: new Date().toISOString(),
        }).eq('id', 'kling-billing');
        json(res, 200, { success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { data: current } = await memory.getSupabaseClient().from('data_sync_status').select('consecutive_failures').eq('id', 'kling-billing').single();
        const failures = (current?.consecutive_failures ?? 0) + 1;
        await memory.getSupabaseClient().from('data_sync_status').update({
          last_failure_at: new Date().toISOString(),
          last_error: message,
          consecutive_failures: failures,
          status: failures >= 3 ? 'failing' : 'stale',
          updated_at: new Date().toISOString(),
        }).eq('id', 'kling-billing');
        json(res, 500, { success: false, error: message });
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
        const { data: agents } = await memory.getSupabaseClient()
          .from('company_agents')
          .select('role, last_run_at');
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

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole ?? body.agent;

      // Build conversational message — always frame as founder chat
      let message = body.message as string | undefined;
      const history = body.history as { role: string; content: string }[] | undefined;
      if (message) {
        if (history?.length) {
          const contextLines = history.map((h) =>
            h.role === 'user' ? `Founder: ${h.content}` : `You: ${h.content}`,
          );
          message = [
            '## Prior conversation',
            ...contextLines,
            '',
            '## Current message',
            `Founder: ${message}`,
            '',
            'Respond to the founder\'s current message. Use the prior conversation for context.',
          ].join('\n');
        } else {
          // First message — still frame as founder chat so agents detect conversational tone
          message = `Founder: ${message}\n\nRespond directly to the founder. Match the tone and energy of their message.`;
        }
      }

      const result = await router.route({
        source: 'manual',
        agentRole,
        task: body.task,
        payload: { ...(body.payload ?? {}), message },
      });

      // Record agent output back to work_assignments if this run was dispatched by orchestration
      const assignmentId = body.payload?.directiveAssignmentId as string | undefined;
      if (assignmentId && result.action === 'executed') {
        await memory.getSupabaseClient()
          .from('work_assignments')
          .update({
            agent_output: result.output ?? result.error ?? 'No output captured',
            status: result.error ? 'failed' : 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', assignmentId);
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

      const { data: agent, error: createErr } = await memory.getSupabaseClient()
        .from('company_agents')
        .insert({
          id: agentId,
          role: agentId,
          codename: name,
          name,
          title: title ?? '',
          department: department ?? '',
          reports_to: reports_to ?? null,
          status: 'active',
          model: model || 'gemini-3-flash-preview',
          temperature: temperature ?? 0.3,
          max_turns: max_turns ?? 10,
          budget_per_run: budget_per_run ?? 0.05,
          budget_daily: budget_daily ?? 0.50,
          budget_monthly: budget_monthly ?? 15,
          is_temporary: is_temporary || false,
          expires_at: is_temporary && ttl_days
            ? new Date(Date.now() + ttl_days * 86400000).toISOString()
            : null,
          is_core: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createErr) {
        json(res, 400, { success: false, error: createErr.message });
        return;
      }

      // Store dynamic brief
      if (system_prompt || skills || agentTools) {
        await memory.getSupabaseClient().from('agent_briefs').upsert({
          agent_id: agentId,
          system_prompt: system_prompt ?? '',
          skills: skills ?? [],
          tools: agentTools ?? [],
          updated_at: new Date().toISOString(),
        });
      }

      // Store schedule if provided
      if (cron_expression) {
        await memory.getSupabaseClient().from('agent_schedules').insert({
          agent_id: agentId,
          cron_expression,
          task: 'scheduled_run',
          enabled: true,
        });
      }

      // Log creation
      await memory.getSupabaseClient().from('activity_log').insert({
        agent_id: 'system',
        action: 'agent.created',
        detail: `New agent created: ${name} (${agentId})`,
        created_at: new Date().toISOString(),
      });

      json(res, 200, { success: true, agent });
      return;
    }

    // Update agent settings
    const settingsMatch = url.match(/^\/agents\/([^/]+)\/settings$/);
    if (method === 'PUT' && settingsMatch) {
      const agentId = decodeURIComponent(settingsMatch[1]);
      const updates = JSON.parse(await readBody(req));

      const { system_prompt, ...agentUpdates } = updates;

      const { data, error: updateErr } = await memory.getSupabaseClient()
        .from('company_agents')
        .update({ ...agentUpdates, updated_at: new Date().toISOString() })
        .eq('id', agentId)
        .select()
        .single();

      if (updateErr) {
        json(res, 400, { success: false, error: updateErr.message });
        return;
      }

      if (system_prompt !== undefined) {
        await memory.getSupabaseClient().from('agent_briefs').upsert({
          agent_id: agentId,
          system_prompt,
          updated_at: new Date().toISOString(),
        });
      }

      await memory.getSupabaseClient().from('activity_log').insert({
        agent_id: 'system',
        action: 'agent.settings_updated',
        detail: `Settings updated for ${agentId}: ${Object.keys(updates).join(', ')}`,
        created_at: new Date().toISOString(),
      });

      json(res, 200, { success: true, agent: data });
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
      await memory.getSupabaseClient()
        .from('company_agents')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', agentId);
      json(res, 200, { success: true });
      return;
    }

    // Resume agent
    const resumeMatch = url.match(/^\/agents\/([^/]+)\/resume$/);
    if (method === 'POST' && resumeMatch) {
      const agentId = decodeURIComponent(resumeMatch[1]);
      await memory.getSupabaseClient()
        .from('company_agents')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', agentId);
      json(res, 200, { success: true });
      return;
    }

    // Retire (soft-delete) agent
    const deleteMatch = url.match(/^\/agents\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const agentId = decodeURIComponent(deleteMatch[1]);
      await memory.getSupabaseClient()
        .from('company_agents')
        .update({ status: 'retired', updated_at: new Date().toISOString() })
        .eq('id', agentId);
      await memory.getSupabaseClient()
        .from('agent_schedules')
        .update({ enabled: false })
        .eq('agent_id', agentId);
      json(res, 200, { success: true });
      return;
    }

    // ─── Analysis Engine Endpoints ──────────────────────────────

    // Launch analysis
    if (method === 'POST' && url === '/analysis/run') {
      const body = JSON.parse(await readBody(req));
      const { type, query, depth, requestedBy } = body;
      const id = await analysisEngine.launch({
        type: type as AnalysisType,
        query,
        depth: (depth ?? 'standard') as AnalysisDepth,
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

    // List analyses
    if (method === 'GET' && url === '/analysis') {
      const records = await analysisEngine.list();
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

    // Enhance analysis (McKinsey-grade deep-dive with additional perspectives)
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
      const { data } = await memory.getSupabaseClient()
        .from('analyses').select('visual_image').eq('id', id).single();
      if (data?.visual_image) {
        json(res, 200, { image: data.visual_image, mimeType: 'image/png' });
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
      await memory.getSupabaseClient()
        .from('analyses').update({ visual_image: watermarked }).eq('id', id);

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
      const ddId = await deepDiveEngine.launch({
        target,
        context: ddContext,
        requestedBy: requestedBy ?? 'dashboard',
      });
      json(res, 200, { success: true, id: ddId });
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
      const { data } = await memory.getSupabaseClient()
        .from('deep_dives').select('visual_image').eq('id', ddId).single();
      if (data?.visual_image) {
        json(res, 200, { image: data.visual_image, mimeType: 'image/png' });
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
      await memory.getSupabaseClient()
        .from('deep_dives').update({ visual_image: watermarked }).eq('id', ddId);

      json(res, 200, { image: watermarked, mimeType: 'image/png' });
      return;
    }

    // ─── Message Endpoints ──────────────────────────────────────

    // Send a message (via API, not tool)
    if (method === 'POST' && url === '/messages/send') {
      const body = JSON.parse(await readBody(req));
      const { from_agent, to_agent, message, message_type, priority, thread_id } = body;
      const { data, error: msgErr } = await memory.getSupabaseClient()
        .from('agent_messages')
        .insert({
          from_agent,
          to_agent,
          thread_id: thread_id ?? crypto.randomUUID(),
          message,
          message_type: message_type ?? 'info',
          priority: priority ?? 'normal',
          status: 'pending',
        })
        .select('id, thread_id')
        .single();
      if (msgErr) { json(res, 400, { success: false, error: msgErr.message }); return; }

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
      const { data } = await memory.getSupabaseClient()
        .from('agent_messages')
        .select('*')
        .or(`from_agent.eq.${agentRole},to_agent.eq.${agentRole}`)
        .order('created_at', { ascending: false })
        .limit(50);
      json(res, 200, data ?? []);
      return;
    }

    // Get all recent messages
    if (method === 'GET' && url === '/messages') {
      const { data } = await memory.getSupabaseClient()
        .from('agent_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      json(res, 200, data ?? []);
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
      const sb = memory.getSupabaseClient();
      const params = new URLSearchParams(url.split('?')[1] || '');
      const status = params.get('status') || 'active';

      let query = sb
        .from('founder_directives')
        .select('*, work_assignments(*)')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (status !== 'all') query = query.eq('status', status);

      const { data, error } = await query;
      if (error) { json(res, 500, { error: error.message }); return; }
      json(res, 200, data);
      return;
    }

    // Create directive
    if (method === 'POST' && url === '/directives') {
      const sb = memory.getSupabaseClient();
      const body = JSON.parse(await readBody(req));
      const { data, error } = await sb
        .from('founder_directives')
        .insert({
          title: body.title,
          description: body.description,
          priority: body.priority || 'high',
          category: body.category || 'general',
          target_agents: body.target_agents || [],
          due_date: body.due_date || null,
          created_by: body.created_by || 'kristina',
        })
        .select()
        .single();
      if (error) { json(res, 500, { error: error.message }); return; }
      json(res, 201, data);
      return;
    }

    // Update directive
    const directivePatchMatch = url.match(/^\/directives\/([^/?]+)$/);
    if (method === 'PATCH' && directivePatchMatch) {
      const sb = memory.getSupabaseClient();
      const id = decodeURIComponent(directivePatchMatch[1]);
      const body = JSON.parse(await readBody(req));
      body.updated_at = new Date().toISOString();
      const { data, error } = await sb
        .from('founder_directives')
        .update(body)
        .eq('id', id)
        .select()
        .single();
      if (error) { json(res, 500, { error: error.message }); return; }
      json(res, 200, data);
      return;
    }

    // Delete directive
    const directiveDeleteMatch = url.match(/^\/directives\/([^/?]+)$/);
    if (method === 'DELETE' && directiveDeleteMatch) {
      const sb = memory.getSupabaseClient();
      const id = decodeURIComponent(directiveDeleteMatch[1]);
      const { error } = await sb
        .from('founder_directives')
        .delete()
        .eq('id', id);
      if (error) { json(res, 500, { error: error.message }); return; }
      json(res, 200, { success: true });
      return;
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
    `Style: clean modern flat design, white background, generous whitespace, minimal text. Use large icons, bold number callouts, color blocks, and data visualizations. Think McKinsey consulting slide deck — NOT a text document.`,
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

server.listen(PORT, () => {
  console.log(`[Scheduler] Listening on port ${PORT}`);

  // Recover any analyses orphaned by a previous container restart
  analysisEngine.recoverStale().catch((err) =>
    console.error('[Scheduler] Failed to recover stale analyses:', err),
  );

  // Start dynamic scheduler for DB-defined cron jobs
  const dynamicScheduler = new DynamicScheduler(memory.getSupabaseClient(), trackedAgentExecutor);
  dynamicScheduler.start();

  // Start data sync scheduler (fires DATA_SYNC_JOBS on their cron schedule)
  const dataSyncScheduler = new DataSyncScheduler(PORT);
  dataSyncScheduler.start();
});
