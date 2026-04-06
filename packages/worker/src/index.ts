import express from 'express';
import { systemQuery } from '@glyphor/shared/db';
import { checkDbHealth } from '@glyphor/shared/db';
import { OAuth2Client } from 'google-auth-library';
import type { CompanyAgentRole, ConversationAttachment, ConversationTurn } from '@glyphor/agent-runtime';
import type { RouteResult } from '@glyphor/scheduler';
import {
  runChiefOfStaff, runCTO, runCFO, runCLO, runCPO, runCMO, runVPSales, runVPDesign,
  runPlatformEngineer, runQualityEngineer, runDevOpsEngineer,
  runUserResearcher, runCompetitiveIntel,
  runContentCreator, runSeoAnalyst, runSocialMediaManager,
  runUiUxDesigner, runFrontendEngineer, runDesignCritic, runTemplateArchitect,
  runM365Admin, runGlobalAdmin, runHeadOfHR, runOps,
  runCompetitiveResearchAnalyst, runMarketResearchAnalyst, runVPResearch,
  runDynamicAgent, runPlatformIntel,
} from '@glyphor/agents';

const app = express();
app.use(express.json());
const oidcClient = new OAuth2Client();

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getRequestOrigin(req: express.Request): string | null {
  const forwardedProto = getHeaderString(req.headers['x-forwarded-proto']);
  const forwardedHost = getHeaderString(req.headers['x-forwarded-host']) ?? req.get('host');
  if (!forwardedHost) return null;
  return `${forwardedProto ?? 'https'}://${forwardedHost}`;
}

async function requireInternalAuth(
  req: express.Request,
  res: express.Response,
  endpointPath: string,
): Promise<boolean> {
  const authorization = getHeaderString(req.headers.authorization);
  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Bearer token required' });
    return false;
  }

  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).json({ ok: false, error: 'Missing bearer token' });
    return false;
  }

  const requestOrigin = getRequestOrigin(req);
  const audienceCandidates = Array.from(new Set([
    process.env.WORKER_OIDC_AUDIENCE?.trim() || null,
    requestOrigin ? `${requestOrigin}${endpointPath}` : null,
    requestOrigin,
  ].filter((value): value is string => Boolean(value && value.trim()))));

  if (audienceCandidates.length === 0) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }

  let verifiedEmail: string | undefined;
  let verified = false;
  for (const audience of audienceCandidates) {
    try {
      const ticket = await oidcClient.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      verifiedEmail = typeof payload?.email === 'string' ? payload.email : undefined;
      verified = true;
      break;
    } catch {
      // try next audience candidate
    }
  }

  if (!verified) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }

  const expectedServiceAccount = process.env.WORKER_OIDC_SERVICE_ACCOUNT_EMAIL?.trim();
  if (expectedServiceAccount && verifiedEmail && verifiedEmail !== expectedServiceAccount) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }

  return true;
}

async function requireInternalServiceAuth(
  req: express.Request,
  res: express.Response,
  endpointPath: string,
): Promise<boolean> {
  const expectedSharedSecret = process.env.WORKER_SHARED_SECRET?.trim();
  const providedSharedSecret = getHeaderString(req.headers['x-worker-shared-secret']);
  if (expectedSharedSecret && providedSharedSecret && providedSharedSecret === expectedSharedSecret) {
    return true;
  }
  return requireInternalAuth(req, res, endpointPath);
}

// Lazy-load WorkflowOrchestrator to avoid pulling the full agent-runtime barrel at startup
let _orchestrator: any;
let _deepDiveEngine: Promise<import('@glyphor/scheduler').DeepDiveEngine> | null = null;

async function getWorkflowOrchestrator() {
  if (!_orchestrator) {
    const { WorkflowOrchestrator } = await import('@glyphor/agent-runtime');
    _orchestrator = new WorkflowOrchestrator();
  }
  return _orchestrator;
}

async function getDeepDiveEngine() {
  if (!_deepDiveEngine) {
    _deepDiveEngine = Promise.all([
      import('@glyphor/agent-runtime'),
      import('@glyphor/scheduler'),
    ]).then(([agentRuntime, scheduler]) => {
      const modelClient = new agentRuntime.ModelClient({
        geminiApiKey: process.env.GOOGLE_AI_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
      return new scheduler.DeepDiveEngine(modelClient);
    });
  }
  return _deepDiveEngine;
}

interface WorkerAgentExecutePayload {
  runId: string;
  agentRole: CompanyAgentRole;
  task: string;
  payload: Record<string, unknown>;
  message?: string;
  conversationHistory?: ConversationTurn[];
  attachments?: ConversationAttachment[];
  assignmentId?: string;
  directiveId?: string;
}

function buildConversationHistoryWithCarriers(input: WorkerAgentExecutePayload): ConversationTurn[] | undefined {
  const history = Array.isArray(input.conversationHistory) ? [...input.conversationHistory] : [];
  if (input.runId) {
    history.push({ role: 'user', content: `__db_run_id__:${input.runId}`, timestamp: Date.now() });
  }
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    history.push({ role: 'user', content: '__multimodal_attachments__', timestamp: Date.now(), attachments: input.attachments });
  }
  if (input.assignmentId) {
    history.push({ role: 'user', content: `__assignment_id__:${input.assignmentId}`, timestamp: Date.now() });
  }
  if (input.directiveId) {
    history.push({ role: 'user', content: `__directive_id__:${input.directiveId}`, timestamp: Date.now() });
  }
  return history.length > 0 ? history : undefined;
}

function buildWorkerPayload(input: WorkerAgentExecutePayload): {
  message?: string;
  conversationHistory?: ConversationTurn[];
  payload: Record<string, unknown>;
} {
  const mergedPayload = { ...(input.payload ?? {}) };
  const msg = typeof input.message === 'string' ? input.message : undefined;
  const conversationHistory = buildConversationHistoryWithCarriers(input);
  return {
    message: msg,
    conversationHistory,
    payload: mergedPayload,
  };
}

async function executeAgentByRole(input: WorkerAgentExecutePayload): Promise<RouteResult> {
  const { agentRole, task } = input;
  const mappedTask = task === 'read_inbox' ? 'agent365_mail_triage' : task;
  const { message, conversationHistory, payload } = buildWorkerPayload(input);

  try {
    let result;
    if (
      (task === 'work_loop' || task === 'proactive') &&
      !message &&
      agentRole !== 'cmo'
    ) {
      const effectiveMessage =
        (payload.wake_reason as string) ||
        (typeof payload.context === 'string' ? `Work loop — ${String(payload.context)}` : '') ||
        `Work loop: ${task}`;
      return executeAgentByRole({ ...input, message: effectiveMessage });
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
        work_loop: 'orchestrate',
        proactive: 'orchestrate',
        strategic_planning: 'strategic_planning',
      };
      const mapped = taskMap[task] ?? 'on_demand';
      result = await runChiefOfStaff({
        task: mapped,
        recipient: payload.founder as 'kristina' | 'andrew' | undefined,
        message,
        context: payload.context as Record<string, unknown> | undefined,
        conversationHistory,
      });
    } else if (agentRole === 'cto') {
      result = await runCTO({ task: task as 'platform_health_check' | 'dependency_review' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'cfo') {
      result = await runCFO({ task: task as 'daily_cost_check' | 'weekly_financial_summary' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'clo') {
      result = await runCLO({ task: mappedTask as 'regulatory_scan' | 'contract_review' | 'compliance_check' | 'agent365_mail_triage' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'cpo') {
      result = await runCPO({ task: task as 'weekly_usage_analysis' | 'competitive_scan' | 'on_demand', message, conversationHistory });
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
          cmoMessage = 'Scheduled: check and execute pending marketing assignments — review work queue, orchestrate team output, flag blockers to Sarah.';
        }
      }
      result = await runCMO({
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
      result = await runVPSales({ task: task as 'pipeline_review' | 'market_sizing' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'vp-design') {
      result = await runVPDesign({ task: task as 'design_audit' | 'design_system_review' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'platform-engineer') {
      result = await runPlatformEngineer({ task: task as 'health_check' | 'metrics_report' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'quality-engineer') {
      result = await runQualityEngineer({ task: task as 'qa_report' | 'regression_check' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'devops-engineer') {
      result = await runDevOpsEngineer({ task: task as 'optimization_scan' | 'pipeline_report' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'user-researcher') {
      result = await runUserResearcher({ task: task as 'cohort_analysis' | 'churn_signals' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'competitive-intel') {
      result = await runCompetitiveIntel({ task: task as 'landscape_scan' | 'deep_dive' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'content-creator') {
      result = await runContentCreator({ task: task as 'blog_draft' | 'social_batch' | 'performance_review' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'seo-analyst') {
      result = await runSeoAnalyst({ task: task as 'ranking_report' | 'keyword_research' | 'competitor_gap' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'social-media-manager') {
      result = await runSocialMediaManager({ task: task as 'engagement_report' | 'schedule_batch' | 'mention_scan' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'ui-ux-designer') {
      result = await runUiUxDesigner({ task: task as 'component_spec' | 'design_token_review' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'frontend-engineer') {
      result = await runFrontendEngineer({ task: task as 'implement_component' | 'accessibility_audit' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'design-critic') {
      result = await runDesignCritic({ task: task as 'grade_builds' | 'quality_report' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'template-architect') {
      result = await runTemplateArchitect({ task: task as 'variant_review' | 'template_quality_audit' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'm365-admin') {
      result = await runM365Admin({ task: mappedTask as 'channel_audit' | 'user_audit' | 'agent365_mail_triage' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'global-admin') {
      result = await runGlobalAdmin({ task: mappedTask as 'access_audit' | 'compliance_report' | 'onboarding' | 'agent365_mail_triage' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'head-of-hr') {
      result = await runHeadOfHR({ task: mappedTask as 'workforce_audit' | 'onboard_agent' | 'retire_agent' | 'agent365_mail_triage' | 'on_demand', message, conversationHistory });
    } else if (agentRole === 'ops') {
      result = await runOps({ task: task as 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'contradiction_detection' | 'knowledge_hygiene', message, eventPayload: payload, conversationHistory });
    } else if (agentRole === 'platform-intel') {
      result = await runPlatformIntel({
        task: task as 'daily_analysis' | 'on_demand' | 'watch_tool_gaps' | 'memory_consolidation',
        message,
        conversationHistory,
      });
    } else if (agentRole === 'vp-research') {
      result = await runVPResearch({ task: task as 'decompose_research' | 'qc_and_package_research' | 'follow_up_research' | 'on_demand', message, analysisId: payload.analysisId as string | undefined, query: payload.query as string | undefined, analysisType: payload.analysisType as string | undefined, depth: payload.depth as string | undefined, sarahNotes: payload.sarahNotes as string | undefined, rawPackets: payload.rawPackets as Record<string, unknown> | undefined, executiveRouting: payload.executiveRouting as Record<string, string[]> | undefined, gaps: payload.gaps as unknown[] | undefined, conversationHistory });
    } else if (agentRole === 'competitive-research-analyst') {
      result = await runCompetitiveResearchAnalyst({ task: task as 'research' | 'on_demand', message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
    } else if (agentRole === 'market-research-analyst') {
      result = await runMarketResearchAnalyst({ task: task as 'research' | 'on_demand', message, researchBrief: payload.researchBrief as string | undefined, searchQueries: payload.searchQueries as string[] | undefined, analysisId: payload.analysisId as string | undefined, conversationHistory });
    } else {
      result = await runDynamicAgent({ role: agentRole, task, message, conversationHistory });
    }

    const routeResult: RouteResult = {
      routed: true,
      action: 'executed',
      agentRole,
      task,
      output: result?.output ?? null,
      status: result?.status,
      error: result?.error ?? result?.abortReason,
      actions: result?.actions,
      dashboardChatEmbeds: result?.dashboardChatEmbeds,
    };
    return routeResult;
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    return {
      routed: false,
      action: 'rejected',
      agentRole,
      task,
      error: messageText,
      reason: `Execution error: ${messageText}`,
    };
  }
}

app.get('/health', async (_req, res) => {
  const dbHealthy = await checkDbHealth();
  res.json({ status: dbHealthy ? 'ok' : 'degraded', db: dbHealthy });
});

app.post('/run', async (req, res) => {
  const authed = await requireInternalServiceAuth(req, res, '/run');
  if (!authed) return;
  const { tenantId, agentRole, taskType, modelTier, metadata } = req.body;
  const startTime = Date.now();

  try {
    // ── Workflow step dispatch ──
    if (req.body.workflow_id && req.body.step_index !== undefined) {
      try {
        const result = await executeWorkflowStep(req.body);
        const orchestrator = await getWorkflowOrchestrator();
        await orchestrator.advanceWorkflow(
          req.body.workflow_id,
          req.body.step_index,
          result,
        );
      } catch (error: any) {
        const orchestrator = await getWorkflowOrchestrator();
        await orchestrator.handleStepFailure(
          req.body.workflow_id,
          req.body.step_index,
          error.message,
        );
      }
      return res.status(200).json({ success: true, workflow_step: true });
    }

    if (taskType === 'deep_dive_execute') {
      const payload = metadata as {
        deepDiveId?: string;
        target?: string;
        context?: string;
        requestedBy?: string;
      } | undefined;

      if (!payload?.deepDiveId || !payload.target) {
        return res.status(400).json({ error: 'deepDiveId and target are required for deep_dive_execute tasks' });
      }

      const deepDiveEngine = await getDeepDiveEngine();
      await deepDiveEngine.execute(payload.deepDiveId, {
        target: payload.target,
        context: payload.context,
        requestedBy: payload.requestedBy ?? 'worker',
      });

      return res.status(200).json({ success: true, deep_dive_id: payload.deepDiveId, durationMs: Date.now() - startTime });
    }

    if (taskType === 'agent_execute') {
      const payload = metadata as WorkerAgentExecutePayload | undefined;
      if (!payload?.runId || !payload.agentRole || !payload.task) {
        return res.status(400).json({ error: 'runId, agentRole, and task are required for agent_execute tasks' });
      }
      const result = await executeAgentByRole(payload);
      return res.status(200).json(result);
    }

    // Load tenant and agent configuration
    const [tenant] = await systemQuery(
      'SELECT * FROM tenants WHERE id = $1', [tenantId]
    );
    const [agent] = await systemQuery(
      'SELECT * FROM tenant_agents WHERE tenant_id = $1 AND agent_role = $2',
      [tenantId, agentRole]
    );

    if (!tenant || !agent) {
      console.error(`Missing tenant or agent: ${tenantId}/${agentRole}`);
      return res.status(404).json({ error: 'Not found' });
    }

    // TODO: Execute the agent run via @glyphor/agent-runtime
    const durationMs = Date.now() - startTime;
    console.log(`Agent run completed: ${tenantId}/${agentRole} (${durationMs}ms)`);

    // Update last_run_at
    await systemQuery(
      'UPDATE tenant_agents SET last_run_at = NOW() WHERE tenant_id = $1 AND agent_role = $2',
      [tenantId, agentRole]
    );

    res.status(200).json({ success: true, durationMs });
  } catch (error: any) {
    console.error(`Agent run failed: ${tenantId}/${agentRole}`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/deliver', async (req, res) => {
  const authed = await requireInternalAuth(req, res, '/deliver');
  if (!authed) return;
  const { tenantId, agentRole, channel, content, platform } = req.body;

  try {
    // TODO: Implement delivery via platform-specific handlers
    console.log(`Delivering ${agentRole} output to ${platform}/${channel} for tenant ${tenantId}`);
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`Delivery failed: ${tenantId}/${agentRole}`, error);
    res.status(500).json({ error: error.message });
  }
});

// ── Workflow step executor ──────────────────────────────────────

async function executeWorkflowStep(payload: Record<string, unknown>): Promise<{ output: unknown }> {
  const stepType = payload.stepType as string;
  const stepConfig = (typeof payload.stepConfig === 'string'
    ? JSON.parse(payload.stepConfig)
    : payload.stepConfig) as Record<string, unknown>;

  switch (stepType) {
    case 'agent_run': {
      const agentRole = stepConfig.agent_role as string;
      const message = stepConfig.message as string;
      console.log(`[Worker] Workflow step: agent_run for ${agentRole}`);
      // TODO: invoke agent via agent-runtime when wired
      return { output: { agent_role: agentRole, message, status: 'completed' } };
    }
    case 'parallel_agents': {
      const agents = (stepConfig.agents ?? []) as Record<string, unknown>[];
      console.log(`[Worker] Workflow step: parallel_agents (${agents.length} agents)`);
      const results = agents.map((a, i) => ({
        sub_index: i,
        role: a.role,
        status: 'completed',
      }));
      return { output: { sub_results: results, completed: agents.length, total: agents.length } };
    }
    case 'evaluate': {
      console.log(`[Worker] Workflow step: evaluate`);
      return { output: { evaluation: 'passed', criteria: stepConfig.criteria } };
    }
    case 'synthesize': {
      console.log(`[Worker] Workflow step: synthesize`);
      return { output: { synthesis: 'completed' } };
    }
    default: {
      console.log(`[Worker] Workflow step: unknown type ${stepType}`);
      return { output: { step_type: stepType, status: 'completed' } };
    }
  }
}

// ── Workflow parallel sub-step completion ────────────────────────

app.post('/workflow/step-complete', async (req, res) => {
  const authed = await requireInternalAuth(req, res, '/workflow/step-complete');
  if (!authed) return;
  const { workflow_id, step_index, sub_index, result } = req.body;
  if (!workflow_id || step_index === undefined || sub_index === undefined) {
    return res.status(400).json({ error: 'workflow_id, step_index, and sub_index are required' });
  }
  try {
    const orchestrator = await getWorkflowOrchestrator();
    await orchestrator.recordParallelSubCompletion(
      workflow_id,
      step_index,
      sub_index,
      result ?? {},
    );
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`[Worker] Step complete failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Worker listening on port ${PORT}`));
