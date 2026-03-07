import express from 'express';
import { systemQuery } from '@glyphor/shared/db';
import { checkDbHealth } from '@glyphor/shared/db';
import { WorkflowOrchestrator } from '@glyphor/agent-runtime';

const app = express();
app.use(express.json());

const workflowOrchestrator = new WorkflowOrchestrator();

app.get('/health', async (_req, res) => {
  const dbHealthy = await checkDbHealth();
  res.json({ status: dbHealthy ? 'ok' : 'degraded', db: dbHealthy });
});

app.post('/run', async (req, res) => {
  const { tenantId, agentRole, taskType, modelTier, metadata } = req.body;
  const startTime = Date.now();

  try {
    // ── Workflow step dispatch ──
    if (req.body.workflow_id && req.body.step_index !== undefined) {
      try {
        const result = await executeWorkflowStep(req.body);
        await workflowOrchestrator.advanceWorkflow(
          req.body.workflow_id,
          req.body.step_index,
          result,
        );
      } catch (error: any) {
        await workflowOrchestrator.handleStepFailure(
          req.body.workflow_id,
          req.body.step_index,
          error.message,
        );
      }
      return res.status(200).json({ success: true, workflow_step: true });
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
  const { workflow_id, step_index, sub_index, result } = req.body;
  if (!workflow_id || step_index === undefined || sub_index === undefined) {
    return res.status(400).json({ error: 'workflow_id, step_index, and sub_index are required' });
  }
  try {
    await workflowOrchestrator.recordParallelSubCompletion(
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
