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
import { GlyphorEventBus } from '@glyphor/agent-runtime';
import type { CompanyAgentRole, AgentExecutionResult, GlyphorEvent } from '@glyphor/agent-runtime';
import { handleStripeWebhook, syncStripeAll, syncBillingToSupabase, syncMercuryAll } from '@glyphor/integrations';
import { EventRouter } from './eventRouter.js';
import { DecisionQueue } from './decisionQueue.js';
import {
  runChiefOfStaff, runCTO, runCFO, runCPO, runCMO, runVPCS, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runRevenueAnalyst, runCostAnalyst,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runOnboardingSpecialist, runSupportTriage,
  runAccountResearch,
} from '@glyphor/agents';

const PORT = parseInt(process.env.PORT || '8080', 10);

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
    const taskMap: Record<string, 'generate_briefing' | 'check_escalations' | 'on_demand'> = {
      morning_briefing: 'generate_briefing',
      check_escalations: 'check_escalations',
      eod_summary: 'generate_briefing',
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
  } else {
    console.log(`[Scheduler] Agent ${agentRole} not recognized, skipping task: ${task}`);
  }
};

const router = new EventRouter(agentExecutor, decisionQueue);

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
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  try {
    // Health check
    if (url === '/health' || url === '/') {
      json(res, 200, { status: 'ok', service: 'glyphor-scheduler' });
      return;
    }

    // Stripe webhook endpoint
    if (method === 'POST' && url === '/webhook/stripe') {
      const rawBody = await readBody(req);
      const result = await handleStripeWebhook(req, rawBody, memory.getSupabaseClient());
      json(res, result.status, result.body);
      return;
    }

    // Stripe data sync endpoint (called by Cloud Scheduler)
    if (method === 'POST' && url === '/sync/stripe') {
      const result = await syncStripeAll(memory.getSupabaseClient());
      json(res, 200, { success: true, ...result });
      return;
    }

    // GCP billing sync endpoint
    if (method === 'POST' && url === '/sync/gcp-billing') {
      const projectId = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
      const billingDataset = process.env.GCP_BILLING_DATASET || 'billing_export';
      const billingTable = process.env.GCP_BILLING_TABLE || 'gcp_billing_export_v1';
      const result = await syncBillingToSupabase(
        memory.getSupabaseClient(), projectId, billingDataset, billingTable,
      );
      json(res, 200, { success: true, ...result });
      return;
    }

    // Mercury banking sync endpoint
    if (method === 'POST' && url === '/sync/mercury') {
      const result = await syncMercuryAll(memory.getSupabaseClient());
      json(res, 200, { success: true, ...result });
      return;
    }

    // Pub/Sub push endpoint
    if (method === 'POST' && url === '/pubsub') {
      const body = JSON.parse(await readBody(req));
      // Pub/Sub wraps the message in { message: { data: base64 } }
      const messageData = Buffer.from(body.message.data, 'base64').toString('utf-8');
      console.log(`[Scheduler] Pub/Sub message: ${messageData}`);

      const result = await router.handleSchedulerMessage(messageData);
      json(res, 200, result);
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
      json(res, 200, { event: event.type, results });
      return;
    }

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole ?? body.agent;
      const result = await router.route({
        source: 'manual',
        agentRole,
        task: body.task,
        payload: { ...(body.payload ?? {}), message: body.message },
      });
      json(res, 200, result);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[Scheduler] Listening on port ${PORT}`);
});
