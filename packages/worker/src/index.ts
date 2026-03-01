import express from 'express';
import { systemQuery } from '@glyphor/shared/db';
import { checkDbHealth } from '@glyphor/shared/db';

const app = express();
app.use(express.json());

app.get('/health', async (_req, res) => {
  const dbHealthy = await checkDbHealth();
  res.json({ status: dbHealthy ? 'ok' : 'degraded', db: dbHealthy });
});

app.post('/run', async (req, res) => {
  const { tenantId, agentRole, taskType, modelTier, metadata } = req.body;
  const startTime = Date.now();

  try {
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Worker listening on port ${PORT}`));
