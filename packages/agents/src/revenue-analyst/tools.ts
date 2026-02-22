/**
 * Revenue Analyst (Anna Park) — Tools
 * Reports to Nadia Okafor (CFO). Revenue tracking and forecasting.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createRevenueAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_stripe_revenue',
      description: 'Query Stripe revenue data including MRR, subscriptions, and charges for a given period.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d, ytd', required: true }, metric: { type: 'string', description: 'Metric: mrr, arr, charges, subscriptions' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('stripe_data').select('*').eq('metric_type', params.metric || 'mrr').order('recorded_at', { ascending: false }).limit(params.period === '7d' ? 7 : params.period === '30d' ? 30 : 90);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_revenue_by_product',
      description: 'Break down revenue by product line or plan tier.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, groupBy: { type: 'string', description: 'Group by: product, plan_tier, interval' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('stripe_data').select('*').eq('metric_type', 'revenue_by_product').order('recorded_at', { ascending: false }).limit(50);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_revenue_by_cohort',
      description: 'Analyze revenue retention and expansion by signup cohort.',
      parameters: { cohortMonth: { type: 'string', description: 'Cohort month (YYYY-MM) or "all"', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('stripe_data').select('*').eq('metric_type', 'cohort_revenue').order('recorded_at', { ascending: false });
        if (params.cohortMonth !== 'all') { query = query.eq('cohort', params.cohortMonth); }
        const { data } = await query.limit(100);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_attribution',
      description: 'Query marketing attribution data — which channels drive revenue.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, channel: { type: 'string', description: 'Filter by channel (optional)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('analytics_events').select('*').eq('event_type', 'attribution').order('created_at', { ascending: false }).limit(100);
        if (params.channel) { query = query.eq('channel', params.channel); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'calculate_ltv_cac',
      description: 'Calculate LTV/CAC ratio and payback period from current data.',
      parameters: { segment: { type: 'string', description: 'Customer segment (all, enterprise, startup, individual)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('stripe_data').select('*').eq('metric_type', 'unit_economics').eq('segment', params.segment || 'all').order('recorded_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'forecast_revenue',
      description: 'Generate a revenue forecast based on historical trends and current pipeline.',
      parameters: { horizon: { type: 'string', description: 'Forecast horizon: 30d, 60d, 90d', required: true }, method: { type: 'string', description: 'Method: linear, weighted_average (default: weighted_average)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data: historical } = await supabase.from('stripe_data').select('*').eq('metric_type', 'mrr').order('recorded_at', { ascending: false }).limit(90);
        return { success: true, data: { historical: historical || [], horizon: params.horizon, method: params.method || 'weighted_average' } };
      },
    },
    {
      name: 'query_churn_revenue',
      description: 'Query revenue lost to churn and contraction in a given period.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('stripe_data').select('*').in('metric_type', ['churn_revenue', 'contraction_revenue']).order('recorded_at', { ascending: false }).limit(60);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'revenue-analyst', activity_type: 'revenue_analysis', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
