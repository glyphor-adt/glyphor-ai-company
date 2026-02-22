/**
 * Onboarding Specialist (Emma Wright) — Tools
 * Reports to James Wilson (VP-CS). New user activation and onboarding optimization.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createOnboardingSpecialistTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_onboarding_funnel',
      description: 'Query the onboarding funnel: signup → profile → first build → activation.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, channel: { type: 'string', description: 'Acquisition channel filter (optional)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('analytics_events').select('*').in('event_type', ['signup', 'profile_complete', 'first_build', 'activated']).order('created_at', { ascending: false }).limit(500);
        if (params.channel) { query = query.eq('channel', params.channel); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_first_build_metrics',
      description: 'Get first-build metrics: time to first build, build completion rate, template vs blank.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('analytics_events').select('*').eq('event_type', 'first_build').order('created_at', { ascending: false }).limit(200);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_drop_off_points',
      description: 'Identify where users drop off in the onboarding flow.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('analytics_events').select('*').eq('event_type', 'onboarding_drop_off').order('created_at', { ascending: false }).limit(200);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_welcome_email_metrics',
      description: 'Get welcome email performance: open rates, click rates, unsubscribes.',
      parameters: { template: { type: 'string', description: 'Email template name (optional, all if omitted)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('email_metrics').select('*').eq('campaign_type', 'onboarding').order('recorded_at', { ascending: false }).limit(30);
        if (params.template) { query = query.eq('template_name', params.template); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_activation_rate',
      description: 'Calculate activation rate by cohort, channel, or plan.',
      parameters: { groupBy: { type: 'string', description: 'Group by: cohort, channel, plan', required: true }, period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('analytics_events').select('*').in('event_type', ['signup', 'activated']).order('created_at', { ascending: false }).limit(500);
        return { success: true, data: data || [], groupBy: params.groupBy };
      },
    },
    {
      name: 'query_template_usage',
      description: 'Track which templates new users start with and their success rates.',
      parameters: { period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('analytics_events').select('*').eq('event_type', 'template_used').order('created_at', { ascending: false }).limit(200);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'design_onboarding_experiment',
      description: 'Design an A/B test or onboarding experiment. Saves the experiment design for review.',
      parameters: { hypothesis: { type: 'string', description: 'What you expect to happen', required: true }, variant: { type: 'string', description: 'Description of the variant/change', required: true }, metric: { type: 'string', description: 'Primary metric to measure', required: true }, duration: { type: 'string', description: 'Expected duration (e.g. "2 weeks")' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('experiment_designs').insert({ agent: 'onboarding-specialist', hypothesis: params.hypothesis, variant_description: params.variant, primary_metric: params.metric, duration: params.duration || '2 weeks', status: 'proposed', created_at: new Date().toISOString() });
        return { success: true, message: 'Experiment design saved for review.' };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'onboarding-specialist', activity_type: 'onboarding_analysis', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
