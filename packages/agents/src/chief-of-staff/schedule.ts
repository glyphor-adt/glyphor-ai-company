/**
 * Chief of Staff — Schedule Configuration
 *
 * Always-on Cloud Run service + morning briefing cron jobs.
 */

export const CHIEF_OF_STAFF_SCHEDULE = {
  // Always-on service for event routing and on-demand queries
  service: {
    type: 'cloud-run' as const,
    alwaysOn: true,
    minInstances: 1,
    maxInstances: 1,
  },

  // Morning briefing cron jobs
  crons: [
    {
      name: 'orchestration-cycle',
      schedule: '0 */1 * * *',    // Every hour (backup for heartbeat)
      timezone: 'America/Chicago',
      task: 'orchestrate',
      params: {},
    },
    {
      name: 'briefing-kristina',
      schedule: '0 7 * * *',     // 7:00 AM CT daily
      timezone: 'America/Chicago',
      task: 'generate_briefing',
      params: { recipient: 'kristina' },
    },
    {
      name: 'briefing-andrew',
      schedule: '30 7 * * *',    // 7:30 AM CT daily
      timezone: 'America/Chicago',
      task: 'generate_briefing',
      params: { recipient: 'andrew' },
    },
    {
      name: 'midday-digest',
      schedule: '0 12 * * 1-5',   // Noon CT weekdays
      timezone: 'America/Chicago',
      task: 'midday_digest',
      params: { recipient: 'both' },
    },
    {
      name: 'eod-summary',
      schedule: '0 18 * * 1-5',   // 6 PM CT weekdays
      timezone: 'America/Chicago',
      task: 'generate_briefing',
      params: { recipient: 'both' },
    },
    {
      name: 'weekly-review',
      schedule: '0 9 * * 1',      // Monday 9 AM CT
      timezone: 'America/Chicago',
      task: 'weekly_review',
      params: {},
    },
    {
      name: 'monthly-retrospective',
      schedule: '0 10 1 * *',     // 1st of month 10 AM CT
      timezone: 'America/Chicago',
      task: 'monthly_retrospective',
      params: {},
    },
    {
      name: 'strategic-planning',
      schedule: '0 14 * * 1',     // Monday 2 PM CT
      timezone: 'America/Chicago',
      task: 'strategic_planning',
      params: {},
    },
    {
      name: 'escalation-check',
      schedule: '0 */6 * * *',   // Every 6 hours
      timezone: 'America/Chicago',
      task: 'check_escalations',
      params: {},
    },
  ],

  // Cloud Scheduler HTTP targets
  httpTarget: {
    uri: '/api/agent/chief-of-staff/run',
    httpMethod: 'POST' as const,
  },
} as const;
