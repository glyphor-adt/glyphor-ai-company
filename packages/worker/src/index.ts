import express from 'express';
import { systemQuery } from '@glyphor/shared/db';
import { checkDbHealth } from '@glyphor/shared/db';
import { OAuth2Client } from 'google-auth-library';

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

app.get('/health', async (_req, res) => {
  const dbHealthy = await checkDbHealth();
  res.json({ status: dbHealthy ? 'ok' : 'degraded', db: dbHealthy });
});

app.post('/run', async (req, res) => {
  const authed = await requireInternalAuth(req, res, '/run');
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
