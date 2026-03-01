/**
 * Cost Analyst (Omar Hassan) — Tools
 * Reports to Nadia Okafor (CFO). Infrastructure cost tracking and optimization.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { queryVercelUsage } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

export function createCostAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_gcp_billing',
      description: 'Query GCP billing data by service, product (glyphor/pulse/fuse), project, or time period.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, service: { type: 'string', description: 'GCP service filter (e.g. cloud-run, bigquery, storage)' }, product: { type: 'string', description: 'Product filter: glyphor, pulse, or fuse' }, project: { type: 'string', description: 'GCP project ID filter' } },
      async execute(params) {
        const limit = params.period === '7d' ? 7 : params.period === '30d' ? 30 : 90;
        let sql = 'SELECT * FROM gcp_billing WHERE 1=1';
        const values: unknown[] = [];
        if (params.service) { values.push(params.service); sql += ` AND service=$${values.length}`; }
        if (params.product) { values.push(params.product); sql += ` AND product=$${values.length}`; }
        if (params.project) { values.push(params.project); sql += ` AND project=$${values.length}`; }
        values.push(limit);
        sql += ` ORDER BY recorded_at DESC LIMIT $${values.length}`;
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_supabase_usage',
      description: 'Query Supabase usage metrics: database size, API calls, storage, bandwidth.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM infrastructure_metrics WHERE provider=$1 ORDER BY recorded_at DESC LIMIT 30', ['supabase']);
        return { success: true, data };
      },
    },
    {
      name: 'query_gemini_cost',
      description: 'Query Gemini API costs broken down by agent role.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, agentRole: { type: 'string', description: 'Filter by agent role (optional)' } },
      async execute(params) {
        let sql = 'SELECT agent_role, cost_usd, created_at FROM agent_runs';
        const values: unknown[] = [];
        if (params.agentRole) { values.push(params.agentRole); sql += ` WHERE agent_role=$${values.length}`; }
        sql += ' ORDER BY created_at DESC LIMIT 200';
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_agent_run_costs',
      description: 'Get aggregate agent run costs and efficiency metrics.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT agent_role, cost_usd, tokens_used, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 500');
        return { success: true, data };
      },
    },
    {
      name: 'query_resource_utilization',
      description: 'Query Cloud Run resource utilization (CPU, memory, instances).',
      parameters: { service: { type: 'string', description: 'Cloud Run service name (optional)' } },
      async execute(params) {
        let sql = 'SELECT * FROM infrastructure_metrics WHERE provider=$1 AND metric_type=$2';
        const values: unknown[] = ['gcp', 'utilization'];
        if (params.service) { values.push(params.service); sql += ` AND service=$${values.length}`; }
        sql += ' ORDER BY recorded_at DESC LIMIT 50';
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'identify_waste',
      description: 'Identify unused or underutilized resources across all infrastructure.',
      parameters: { threshold: { type: 'number', description: 'Utilization threshold %. Resources below this are flagged (default: 20)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM infrastructure_metrics WHERE metric_type=$1 AND value < $2 ORDER BY recorded_at DESC LIMIT 50', ['utilization', params.threshold || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'calculate_unit_cost',
      description: 'Calculate unit economics: cost per build, cost per user, cost per agent run.',
      parameters: { metric: { type: 'string', description: 'Unit: per_build, per_user, per_agent_run, per_request', required: true }, period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM cost_metrics WHERE unit_type=$1 ORDER BY recorded_at DESC LIMIT 30', [params.metric]);
        return { success: true, data };
      },
    },
    {
      name: 'project_costs',
      description: 'Project future costs based on current trends and growth rate.',
      parameters: { horizon: { type: 'string', description: 'Projection horizon: 30d, 60d, 90d', required: true }, growthRate: { type: 'number', description: 'Assumed monthly growth rate % (default: current)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM gcp_billing ORDER BY recorded_at DESC LIMIT 90');
        return { success: true, data: { historical: data, horizon: params.horizon, growthRate: params.growthRate } };
      },
    },
    {
      name: 'query_vercel_usage',
      description: 'Query Vercel usage: deployment count, build count, error rate, avg build duration across all projects.',
      parameters: {
        days: { type: 'number', description: 'Days to look back (default: 7)', required: false },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const usage = await queryVercelUsage((params.days as number) || 7);
          return { success: true, data: usage };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('VERCEL_TOKEN')) return { success: false, error: 'NO_DATA: VERCEL_TOKEN not configured yet.' };
          return { success: false, error: msg };
        }
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['cost-analyst', 'cost_analysis', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
