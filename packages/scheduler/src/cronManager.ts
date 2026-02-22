/**
 * Cron Manager — Cloud Scheduler configuration and local cron execution
 *
 * Defines scheduled jobs for each agent and handles their execution.
 * In production, these map to GCP Cloud Scheduler → Pub/Sub → Cloud Run.
 * Locally, this module can run jobs directly via the event router.
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';

export interface ScheduledJob {
  id: string;
  agentRole: CompanyAgentRole;
  schedule: string;  // cron expression (UTC)
  timezone: string;
  task: string;
  payload: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Phase 1 scheduled jobs — Chief of Staff briefings.
 * Additional agent schedules added in later phases.
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    id: 'cos-briefing-kristina',
    agentRole: 'chief-of-staff',
    schedule: '0 12 * * 1-5',  // 12:00 UTC = 7:00 AM CT, weekdays
    timezone: 'America/Chicago',
    task: 'morning_briefing',
    payload: { founder: 'kristina' },
    enabled: true,
  },
  {
    id: 'cos-briefing-andrew',
    agentRole: 'chief-of-staff',
    schedule: '30 12 * * 1-5',  // 12:30 UTC = 7:30 AM CT, weekdays
    timezone: 'America/Chicago',
    task: 'morning_briefing',
    payload: { founder: 'andrew' },
    enabled: true,
  },
  {
    id: 'cos-eod-summary',
    agentRole: 'chief-of-staff',
    schedule: '0 23 * * 1-5',  // 23:00 UTC = 6:00 PM CT, weekdays
    timezone: 'America/Chicago',
    task: 'eod_summary',
    payload: {},
    enabled: true,
  },
  // Phase 2+ jobs (disabled until agents are fully implemented)
  {
    id: 'cto-health-check',
    agentRole: 'cto',
    schedule: '*/30 * * * *',  // every 30 minutes
    timezone: 'UTC',
    task: 'platform_health_check',
    payload: {},
    enabled: false,
  },
  {
    id: 'cfo-daily-costs',
    agentRole: 'cfo',
    schedule: '0 14 * * 1-5',  // 9:00 AM CT
    timezone: 'America/Chicago',
    task: 'daily_cost_check',
    payload: {},
    enabled: false,
  },
  {
    id: 'cpo-usage-analysis',
    agentRole: 'cpo',
    schedule: '0 15 * * 1',  // 10:00 AM CT, Mondays
    timezone: 'America/Chicago',
    task: 'weekly_usage_analysis',
    payload: {},
    enabled: false,
  },
  {
    id: 'cmo-content-calendar',
    agentRole: 'cmo',
    schedule: '0 14 * * 1',  // 9:00 AM CT, Mondays
    timezone: 'America/Chicago',
    task: 'weekly_content_planning',
    payload: {},
    enabled: false,
  },
  {
    id: 'vpcs-health-scoring',
    agentRole: 'vp-customer-success',
    schedule: '0 13 * * 1-5',  // 8:00 AM CT, weekdays
    timezone: 'America/Chicago',
    task: 'daily_health_scoring',
    payload: {},
    enabled: false,
  },
  {
    id: 'vps-pipeline-review',
    agentRole: 'vp-sales',
    schedule: '0 14 * * 1,4',  // 9:00 AM CT, Mon & Thu
    timezone: 'America/Chicago',
    task: 'pipeline_review',
    payload: {},
    enabled: false,
  },
];

/**
 * Get all enabled scheduled jobs.
 */
export function getEnabledJobs(): ScheduledJob[] {
  return SCHEDULED_JOBS.filter(j => j.enabled);
}

/**
 * Get scheduled jobs for a specific agent.
 */
export function getJobsForAgent(role: CompanyAgentRole): ScheduledJob[] {
  return SCHEDULED_JOBS.filter(j => j.agentRole === role);
}

/**
 * Generate GCP Cloud Scheduler create commands for deployment.
 */
export function generateCloudSchedulerCommands(
  projectId: string,
  topicName: string,
  region: string = 'us-central1',
): string[] {
  return getEnabledJobs().map(job => {
    const messageBody = JSON.stringify({
      agentRole: job.agentRole,
      task: job.task,
      payload: job.payload,
    });

    return [
      'gcloud scheduler jobs create pubsub',
      job.id,
      `--schedule="${job.schedule}"`,
      `--topic="${topicName}"`,
      `--message-body='${messageBody}'`,
      `--time-zone="${job.timezone}"`,
      `--location="${region}"`,
      `--project="${projectId}"`,
    ].join(' \\\n  ');
  });
}
