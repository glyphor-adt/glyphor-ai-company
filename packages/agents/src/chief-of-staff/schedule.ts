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
