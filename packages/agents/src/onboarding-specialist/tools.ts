/**
 * Onboarding Specialist (Emma Wright) — Tools
 * Reports to James Turner (VP-CS). New user activation and onboarding optimization.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createOnboardingSpecialistTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_onboarding_funnel',
      description: 'Query the onboarding funnel: signup → profile → first build → activation.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, channel: { type: 'string', description: 'Acquisition channel filter (optional)' } },
      async execute(params) {
        const conditions = ['event_type = ANY($1)'];
        const sqlParams: unknown[] = [['signup', 'profile_complete', 'first_build', 'activated']];
        let idx = 2;
        if (params.channel) { conditions.push(`channel = $${idx++}`); sqlParams.push(params.channel); }
        const data = await systemQuery(
          `SELECT * FROM analytics_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 500`,
          sqlParams
        );
        return { success: true, data };
      },
    },
    {
      name: 'query_first_build_metrics',
      description: 'Get first-build metrics: time to first build, build completion rate, template vs blank.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM analytics_events WHERE event_type = $1 ORDER BY created_at DESC LIMIT 200', ['first_build']);
        return { success: true, data };
      },
    },
    {
      name: 'query_drop_off_points',
      description: 'Identify where users drop off in the onboarding flow.',
      parameters: { period: { type: 'string', description: 'Time period', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM analytics_events WHERE event_type = $1 ORDER BY created_at DESC LIMIT 200', ['onboarding_drop_off']);
        return { success: true, data };
      },
    },
    {
      name: 'query_welcome_email_metrics',
      description: 'Get welcome email performance: open rates, click rates, unsubscribes.',
      parameters: { template: { type: 'string', description: 'Email template name (optional, all if omitted)' } },
      async execute(params) {
        const conditions = ['campaign_type = $1'];
        const sqlParams: unknown[] = ['onboarding'];
        let idx = 2;
        if (params.template) { conditions.push(`template_name = $${idx++}`); sqlParams.push(params.template); }
        const data = await systemQuery(
          `SELECT * FROM email_metrics WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT 30`,
          sqlParams
        );
        return { success: true, data };
      },
    },
    {
      name: 'query_activation_rate',
      description: 'Calculate activation rate by cohort, channel, or plan.',
      parameters: { groupBy: { type: 'string', description: 'Group by: cohort, channel, plan', required: true }, period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM analytics_events WHERE event_type = ANY($1) ORDER BY created_at DESC LIMIT 500', [['signup', 'activated']]);
        return { success: true, data, groupBy: params.groupBy };
      },
    },
    {
      name: 'query_template_usage',
      description: 'Track which templates new users start with and their success rates.',
      parameters: { period: { type: 'string', description: 'Time period' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM analytics_events WHERE event_type = $1 ORDER BY created_at DESC LIMIT 200', ['template_used']);
        return { success: true, data };
      },
    },
    {
      name: 'design_onboarding_experiment',
      description: 'Design an A/B test or onboarding experiment. Saves the experiment design for review.',
      parameters: { hypothesis: { type: 'string', description: 'What you expect to happen', required: true }, variant: { type: 'string', description: 'Description of the variant/change', required: true }, metric: { type: 'string', description: 'Primary metric to measure', required: true }, duration: { type: 'string', description: 'Expected duration (e.g. "2 weeks")' } },
      async execute(params) {
        await systemQuery(
          'INSERT INTO experiment_designs (agent, hypothesis, variant_description, primary_metric, duration, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          ['onboarding-specialist', params.hypothesis, params.variant, params.metric, params.duration || '2 weeks', 'proposed', new Date().toISOString()]
        );
        return { success: true, message: 'Experiment design saved for review.' };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery(
          'INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['onboarding-specialist', 'onboarding_analysis', params.summary, params.details || null, new Date().toISOString()]
        );
        return { success: true };
      },
    },
  ];
}
