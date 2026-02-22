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
    schedule: '0 12 * * *',  // 12:00 UTC = 7:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'morning_briefing',
    payload: { founder: 'kristina' },
    enabled: true,
  },
  {
    id: 'cos-briefing-andrew',
    agentRole: 'chief-of-staff',
    schedule: '30 12 * * *',  // 12:30 UTC = 7:30 AM CT, daily
    timezone: 'America/Chicago',
    task: 'morning_briefing',
    payload: { founder: 'andrew' },
    enabled: true,
  },
  {
    id: 'cos-eod-summary',
    agentRole: 'chief-of-staff',
    schedule: '0 23 * * *',  // 23:00 UTC = 6:00 PM CT, daily
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
    enabled: true,
  },
  {
    id: 'cfo-daily-costs',
    agentRole: 'cfo',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'daily_cost_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'cpo-usage-analysis',
    agentRole: 'cpo',
    schedule: '0 15 * * *',  // 10:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'weekly_usage_analysis',
    payload: {},
    enabled: true,
  },
  {
    id: 'cmo-content-calendar',
    agentRole: 'cmo',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'weekly_content_planning',
    payload: {},
    enabled: true,
  },
  {
    id: 'vpcs-health-scoring',
    agentRole: 'vp-customer-success',
    schedule: '0 13 * * *',  // 8:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'daily_health_scoring',
    payload: {},
    enabled: true,
  },
  {
    id: 'vps-pipeline-review',
    agentRole: 'vp-sales',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'pipeline_review',
    payload: {},
    enabled: true,
  },
  // Atlas Vega — Operations agent
  {
    id: 'ops-health-check',
    agentRole: 'ops',
    schedule: '*/10 * * * *',  // every 10 minutes
    timezone: 'UTC',
    task: 'health_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-freshness-check',
    agentRole: 'ops',
    schedule: '*/30 * * * *',  // every 30 minutes
    timezone: 'UTC',
    task: 'freshness_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-cost-check',
    agentRole: 'ops',
    schedule: '0 * * * *',  // every hour
    timezone: 'UTC',
    task: 'cost_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-morning-status',
    agentRole: 'ops',
    schedule: '0 11 * * *',  // 6:00 AM CT
    timezone: 'America/Chicago',
    task: 'morning_status',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-evening-status',
    agentRole: 'ops',
    schedule: '0 22 * * *',  // 5:00 PM CT
    timezone: 'America/Chicago',
    task: 'evening_status',
    payload: {},
    enabled: true,
  },
];

/**
 * Data sync jobs — pull financial data from external services.
 * These call scheduler HTTP endpoints directly (not agent tasks).
 */
export interface DataSyncJob {
  id: string;
  schedule: string;
  timezone: string;
  endpoint: string;
  enabled: boolean;
}

export const DATA_SYNC_JOBS: DataSyncJob[] = [
  {
    id: 'sync-stripe',
    schedule: '0 6 * * *',     // 6:00 UTC = 12:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/stripe',
    enabled: true,
  },
  {
    id: 'sync-gcp-billing',
    schedule: '0 7 * * *',     // 7:00 UTC = 1:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/gcp-billing',
    enabled: true,
  },
  {
    id: 'sync-mercury',
    schedule: '0 8 * * *',     // 8:00 UTC = 2:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/mercury',
    enabled: true,
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
 * Get all enabled data sync jobs.
 */
export function getEnabledSyncJobs(): DataSyncJob[] {
  return DATA_SYNC_JOBS.filter(j => j.enabled);
}

/**
 * Generate GCP Cloud Scheduler create commands for deployment.
 */
export function generateCloudSchedulerCommands(
  projectId: string,
  topicName: string,
  schedulerUrl: string,
  region: string = 'us-central1',
): string[] {
  // Agent task jobs (via Pub/Sub)
  const agentJobs = getEnabledJobs().map(job => {
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

  // Data sync jobs (direct HTTP to scheduler)
  const syncJobs = getEnabledSyncJobs().map(job => {
    return [
      'gcloud scheduler jobs create http',
      job.id,
      `--schedule="${job.schedule}"`,
      `--uri="${schedulerUrl}${job.endpoint}"`,
      `--http-method=POST`,
      `--time-zone="${job.timezone}"`,
      `--location="${region}"`,
      `--project="${projectId}"`,
      `--oidc-service-account-email="${projectId}@appspot.gserviceaccount.com"`,
    ].join(' \\\n  ');
  });

  return [...agentJobs, ...syncJobs];
}
