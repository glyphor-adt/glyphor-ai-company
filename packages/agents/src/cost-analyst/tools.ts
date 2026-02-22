/**
 * Cost Analyst (Omar Hassan) — Tools
 * Reports to Nadia Okafor (CFO). Infrastructure cost tracking and optimization.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createCostAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_gcp_billing',
      description: 'Query GCP billing data by service, SKU, or time period.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, service: { type: 'string', description: 'GCP service filter (e.g. cloud-run, bigquery, storage)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('gcp_billing').select('*').order('recorded_at', { ascending: false }).limit(params.period === '7d' ? 7 : params.period === '30d' ? 30 : 90);
        if (params.service) { query = query.eq('service', params.service); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_supabase_usage',
      description: 'Query Supabase usage metrics: database size, API calls, storage, bandwidth.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('infrastructure_metrics').select('*').eq('provider', 'supabase').order('recorded_at', { ascending: false }).limit(30);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_gemini_cost',
      description: 'Query Gemini API costs broken down by agent role.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, agentRole: { type: 'string', description: 'Filter by agent role (optional)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('agent_runs').select('agent_role, cost_usd, created_at').order('created_at', { ascending: false }).limit(200);
        if (params.agentRole) { query = query.eq('agent_role', params.agentRole); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_agent_run_costs',
      description: 'Get aggregate agent run costs and efficiency metrics.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('agent_runs').select('agent_role, cost_usd, tokens_used, created_at').order('created_at', { ascending: false }).limit(500);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_resource_utilization',
      description: 'Query Cloud Run resource utilization (CPU, memory, instances).',
      parameters: { service: { type: 'string', description: 'Cloud Run service name (optional)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('infrastructure_metrics').select('*').eq('provider', 'gcp').eq('metric_type', 'utilization').order('recorded_at', { ascending: false }).limit(50);
        if (params.service) { query = query.eq('service', params.service); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'identify_waste',
      description: 'Identify unused or underutilized resources across all infrastructure.',
      parameters: { threshold: { type: 'number', description: 'Utilization threshold %. Resources below this are flagged (default: 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('infrastructure_metrics').select('*').eq('metric_type', 'utilization').lt('value', params.threshold || 20).order('recorded_at', { ascending: false }).limit(50);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'calculate_unit_cost',
      description: 'Calculate unit economics: cost per build, cost per user, cost per agent run.',
      parameters: { metric: { type: 'string', description: 'Unit: per_build, per_user, per_agent_run, per_request', required: true }, period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('cost_metrics').select('*').eq('unit_type', params.metric).order('recorded_at', { ascending: false }).limit(30);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'project_costs',
      description: 'Project future costs based on current trends and growth rate.',
      parameters: { horizon: { type: 'string', description: 'Projection horizon: 30d, 60d, 90d', required: true }, growthRate: { type: 'number', description: 'Assumed monthly growth rate % (default: current)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('gcp_billing').select('*').order('recorded_at', { ascending: false }).limit(90);
        return { success: true, data: { historical: data || [], horizon: params.horizon, growthRate: params.growthRate } };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'cost-analyst', activity_type: 'cost_analysis', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
