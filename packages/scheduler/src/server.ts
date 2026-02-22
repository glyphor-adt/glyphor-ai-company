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
import { handleStripeWebhook, syncStripeAll, syncBillingToSupabase, syncMercuryAll, TeamsBotHandler, extractBearerToken } from '@glyphor/integrations';
import { EventRouter } from './eventRouter.js';
import { DecisionQueue } from './decisionQueue.js';
import { DynamicScheduler } from './dynamicScheduler.js';
import { AnalysisEngine } from './analysisEngine.js';
import type { AnalysisType, AnalysisDepth } from './analysisEngine.js';
import { SimulationEngine } from './simulationEngine.js';
import { MeetingEngine } from './meetingEngine.js';
import { exportAnalysisMarkdown, exportAnalysisJSON, exportSimulationMarkdown, exportSimulationJSON } from './reportExporter.js';
import {
  runChiefOfStaff, runCTO, runCFO, runCPO, runCMO, runVPCS, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runRevenueAnalyst, runCostAnalyst,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runOnboardingSpecialist, runSupportTriage,
  runAccountResearch,
  runOps,
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
  }
  // Operations
  else if (agentRole === 'ops') {
    return runOps({ task: (task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response'), message, eventPayload: payload });
  } else {
    console.log(`[Scheduler] Agent ${agentRole} not recognized, skipping task: ${task}`);
  }
};

const router = new EventRouter(agentExecutor, decisionQueue);
const analysisEngine = new AnalysisEngine(memory.getSupabaseClient(), agentExecutor);
const simulationEngine = new SimulationEngine(memory.getSupabaseClient(), agentExecutor);
const meetingEngine = new MeetingEngine(memory.getSupabaseClient(), agentExecutor);

// Teams Bot — initialized from env vars (BOT_APP_ID, BOT_APP_SECRET, BOT_TENANT_ID)
const teamsBot = TeamsBotHandler.fromEnv(
  async (agentRole, task, payload) => {
    const result = await agentExecutor(agentRole as CompanyAgentRole, task, payload);
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
        const billingTable = process.env.GCP_BILLING_TABLE || 'gcp_billing_export_v1';
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

    // Teams Bot endpoint (Bot Framework messages)
    if (method === 'POST' && url === '/api/teams/messages') {
      if (!teamsBot) {
        json(res, 503, { error: 'Teams Bot not configured. Set BOT_APP_ID, BOT_APP_SECRET, BOT_TENANT_ID.' });
        return;
      }

      // Validate bearer token exists (Bot Framework sends JWT)
      const token = extractBearerToken(req);
      if (!token) {
        json(res, 401, { error: 'Missing authorization token' });
        return;
      }

      const activity = JSON.parse(await readBody(req));
      // Respond 200 immediately, process async
      json(res, 200, { status: 'accepted' });
      teamsBot.handleActivity(activity).catch((err) => {
        console.error('[TeamsBot] Error handling activity:', (err as Error).message);
      });
      return;
    }

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const agentRole = body.agentRole ?? body.agent;

      // Build conversational message from history if provided
      let message = body.message as string | undefined;
      const history = body.history as { role: string; content: string }[] | undefined;
      if (history?.length && message) {
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
          'Respond to the current message. Use the prior conversation for context.',
        ].join('\n');
      }

      const result = await router.route({
        source: 'manual',
        agentRole,
        task: body.task,
        payload: { ...(body.payload ?? {}), message },
      });
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

      const format = new URL(url, 'http://localhost').searchParams.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="analysis-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportAnalysisJSON(record));
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

      const format = new URL(url, 'http://localhost').searchParams.get('format') ?? 'markdown';
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="simulation-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(exportSimulationJSON(record));
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

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[Scheduler] Listening on port ${PORT}`);

  // Start dynamic scheduler for DB-defined cron jobs
  const dynamicScheduler = new DynamicScheduler(memory.getSupabaseClient(), agentExecutor);
  dynamicScheduler.start();
});
