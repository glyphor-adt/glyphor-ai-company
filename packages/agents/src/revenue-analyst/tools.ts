/**
 * Revenue Analyst (Anna Park) — Tools
 * Reports to Nadia Okafor (CFO). Revenue tracking and forecasting.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createRevenueAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_stripe_revenue',
      description: 'Query Stripe revenue data including MRR, subscriptions, and charges for a given period.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d, ytd', required: true }, metric: { type: 'string', description: 'Metric: mrr, arr, charges, subscriptions' } },
      async execute(params) {
        const limitVal = params.period === '7d' ? 7 : params.period === '30d' ? 30 : 90;
        const data = await systemQuery('SELECT * FROM stripe_data WHERE metric_type = $1 ORDER BY recorded_at DESC LIMIT $2', [params.metric || 'mrr', limitVal]);
        return { success: true, data };
      },
    },
    {
      name: 'query_revenue_by_product',
      description: 'Break down revenue by product line or plan tier.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, groupBy: { type: 'string', description: 'Group by: product, plan_tier, interval' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM stripe_data WHERE metric_type = $1 ORDER BY recorded_at DESC LIMIT 50', ['revenue_by_product']);
        return { success: true, data };
      },
    },
    {
      name: 'query_revenue_by_cohort',
      description: 'Analyze revenue retention and expansion by signup cohort.',
      parameters: { cohortMonth: { type: 'string', description: 'Cohort month (YYYY-MM) or "all"', required: true } },
      async execute(params) {
        const conditions = ['metric_type = $1'];
        const sqlParams: unknown[] = ['cohort_revenue'];
        let idx = 2;
        if (params.cohortMonth !== 'all') { conditions.push(`cohort = $${idx++}`); sqlParams.push(params.cohortMonth); }
        const data = await systemQuery(
          `SELECT * FROM stripe_data WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT $${idx}`,
          [...sqlParams, 100]
        );
        return { success: true, data };
      },
    },
    {
      name: 'query_attribution',
      description: 'Query marketing attribution data — which channels drive revenue.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, channel: { type: 'string', description: 'Filter by channel (optional)' } },
      async execute(params) {
        const conditions = ['event_type = $1'];
        const sqlParams: unknown[] = ['attribution'];
        let idx = 2;
        if (params.channel) { conditions.push(`channel = $${idx++}`); sqlParams.push(params.channel); }
        const data = await systemQuery(
          `SELECT * FROM analytics_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 100`,
          sqlParams
        );
        return { success: true, data };
      },
    },
    {
      name: 'calculate_ltv_cac',
      description: 'Calculate LTV/CAC ratio and payback period from current data.',
      parameters: { segment: { type: 'string', description: 'Customer segment (all, enterprise, startup, individual)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM stripe_data WHERE metric_type = $1 AND segment = $2 ORDER BY recorded_at DESC LIMIT 1', ['unit_economics', params.segment || 'all']);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'forecast_revenue',
      description: 'Generate a revenue forecast based on historical trends and current pipeline.',
      parameters: { horizon: { type: 'string', description: 'Forecast horizon: 30d, 60d, 90d', required: true }, method: { type: 'string', description: 'Method: linear, weighted_average (default: weighted_average)' } },
      async execute(params) {
        const historical = await systemQuery('SELECT * FROM stripe_data WHERE metric_type = $1 ORDER BY recorded_at DESC LIMIT 90', ['mrr']);
        return { success: true, data: { historical, horizon: params.horizon, method: params.method || 'weighted_average' } };
      },
    },
    {
      name: 'query_churn_revenue',
      description: 'Query revenue lost to churn and contraction in a given period.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM stripe_data WHERE metric_type = ANY($1) ORDER BY recorded_at DESC LIMIT 60', [['churn_revenue', 'contraction_revenue']]);
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        try {
        await systemQuery(
          'INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['revenue-analyst', 'revenue_analysis', params.summary, params.details || null, new Date().toISOString()]
        );
        return { success: true };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
  ];
}
