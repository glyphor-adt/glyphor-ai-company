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
    id: 'cos-briefing-both',
    agentRole: 'chief-of-staff',
    schedule: '0 12 * * *',  // 12:00 UTC = 7:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'morning_briefing',
    payload: { founder: 'both' },
    enabled: true,
  },
  {
    id: 'cos-midday-digest',
    agentRole: 'chief-of-staff',
    schedule: '0 12 * * 1-5',  // 12:00 PM CT, weekdays
    timezone: 'America/Chicago',
    task: 'midday_digest',
    payload: { founder: 'both' },
    enabled: true,
  },
  {
    id: 'cos-eod-summary',
    agentRole: 'chief-of-staff',
    schedule: '0 18 * * 1-5',  // 6:00 PM CT, weekdays
    timezone: 'America/Chicago',
    task: 'eod_summary',
    payload: { founder: 'both' },
    enabled: true,
  },
  {
    id: 'cos-orchestrate',
    agentRole: 'chief-of-staff',
    schedule: '0 * * * *',   // every hour — periodic directive sweep (matches Cloud Scheduler)
    timezone: 'UTC',
    task: 'orchestrate',
    payload: {},
    enabled: true,
  },
  {
    id: 'cos-weekly-review',
    agentRole: 'chief-of-staff',
    schedule: '0 9 * * 1',  // Monday 9:00 AM CT
    timezone: 'America/Chicago',
    task: 'weekly_review',
    payload: {},
    enabled: true,
  },
  {
    id: 'cos-monthly-retrospective',
    agentRole: 'chief-of-staff',
    schedule: '0 10 1 * *',  // 1st of month, 10:00 AM CT
    timezone: 'America/Chicago',
    task: 'monthly_retrospective',
    payload: {},
    enabled: true,
  },
  {
    id: 'cos-strategic-planning',
    agentRole: 'chief-of-staff',
    schedule: '0 14 * * 1',  // Monday 2:00 PM CT
    timezone: 'America/Chicago',
    task: 'strategic_planning',
    payload: {},
    enabled: true,
  },
  {
    id: 'cos-initiative-proposal',
    agentRole: 'chief-of-staff',
    schedule: '0 13 * * 1',  // Monday 8:00 AM CT — initiative proposal cycle
    timezone: 'America/Chicago',
    task: 'strategic_planning',
    payload: { focus: 'initiative_proposals' },
    enabled: false,
  },
  // Phase 2+ jobs (disabled until agents are fully implemented)
  {
    id: 'cto-health-check',
    agentRole: 'cto',
    schedule: '0 */6 * * *',  // every 6 hours (was every 2h — reduced for cost)
    timezone: 'UTC',
    task: 'platform_health_check',
    payload: {},
    enabled: false,
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
    id: 'cfo-afternoon-costs',
    agentRole: 'cfo',
    schedule: '0 20 * * *',  // 3:00 PM CT — catch same-day anomalies
    timezone: 'America/Chicago',
    task: 'daily_cost_check',
    payload: { context: 'afternoon_check' },
    enabled: true,
  },
  {
    id: 'cpo-usage-analysis',
    agentRole: 'cpo',
    schedule: '0 15 * * *',  // 10:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'weekly_usage_analysis',
    payload: {},
    enabled: false,
  },
  {
    id: 'cmo-content-calendar',
    agentRole: 'cmo',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'weekly_content_planning',
    payload: {},
    enabled: false,
  },
  {
    id: 'cmo-afternoon-publishing',
    agentRole: 'cmo',
    schedule: '0 19 * * *',  // 2:00 PM CT — afternoon publishing/scheduling
    timezone: 'America/Chicago',
    task: 'generate_content',
    payload: { context: 'afternoon_publishing' },
    enabled: false,
  },
  {
    id: 'vps-pipeline-review',
    agentRole: 'vp-sales',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'pipeline_review',
    payload: {},
    enabled: false,
  },
  // Atlas Vega — Operations agent
  {
    id: 'ops-health-check',
    agentRole: 'ops',
    schedule: '0 */2 * * *',  // every 2 hours (was every 10 min — reduced for cost)
    timezone: 'UTC',
    task: 'health_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-freshness-check',
    agentRole: 'ops',
    schedule: '0 5,14 * * *',  // 5:00 AM + 2:00 PM CT
    timezone: 'America/Chicago',
    task: 'freshness_check',
    payload: {},
    enabled: true,
  },
  {
    id: 'ops-cost-check',
    agentRole: 'ops',
    schedule: '0 */4 * * *',  // every 4 hours (was hourly — reduced for cost)
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
  {
    id: 'ops-knowledge-hygiene',
    agentRole: 'ops',
    schedule: '0 12 * * *',  // 7:00 AM CT — refresh doctrine before morning briefing
    timezone: 'America/Chicago',
    task: 'knowledge_hygiene',
    payload: {},
    enabled: false,
  },

  // ─── Sub-Team Agent Schedules ────────────────────────────────

  // Engineering sub-team (reports to CTO)
  {
    id: 'platform-eng-daily',
    agentRole: 'platform-engineer',
    schedule: '0 */2 * * *',  // every 2 hours — infrastructure health check
    timezone: 'UTC',
    task: 'health_check',
    payload: {},
    enabled: false,
  },
  {
    id: 'quality-eng-daily',
    agentRole: 'quality-engineer',
    schedule: '0 13 * * *',  // 7:00 AM CT — quality metrics
    timezone: 'America/Chicago',
    task: 'qa_report',
    payload: {},
    enabled: false,
  },
  {
    id: 'devops-eng-daily',
    agentRole: 'devops-engineer',
    schedule: '0 12 * * *',  // 6:00 AM CT — deployment health, CI/CD check
    timezone: 'America/Chicago',
    task: 'pipeline_report',
    payload: {},
    enabled: false,
  },

  // Product sub-team (reports to CPO)
  {
    id: 'user-researcher-daily',
    agentRole: 'user-researcher',
    schedule: '30 16 * * *',  // 10:30 AM CT — usage patterns
    timezone: 'America/Chicago',
    task: 'cohort_analysis',
    payload: {},
    enabled: false,
  },
  {
    id: 'competitive-intel-daily',
    agentRole: 'competitive-intel',
    schedule: '0 14 * * *',  // 8:00 AM CT — competitor monitoring
    timezone: 'America/Chicago',
    task: 'landscape_scan',
    payload: {},
    enabled: false,
  },

  // Marketing sub-team (reports to CMO)
  {
    id: 'content-creator-daily',
    agentRole: 'content-creator',
    schedule: '0 16 * * *',  // 10:00 AM CT — content drafting
    timezone: 'America/Chicago',
    task: 'blog_draft',
    payload: {},
    enabled: false,
  },
  {
    id: 'seo-analyst-daily',
    agentRole: 'seo-analyst',
    schedule: '30 14 * * *',  // 8:30 AM CT — SEO performance
    timezone: 'America/Chicago',
    task: 'ranking_report',
    payload: {},
    enabled: false,
  },
  {
    id: 'social-media-morning',
    agentRole: 'social-media-manager',
    schedule: '0 15 * * *',  // 9:00 AM CT — morning plan
    timezone: 'America/Chicago',
    task: 'schedule_batch',
    payload: {},
    enabled: false,
  },
  {
    id: 'social-media-afternoon',
    agentRole: 'social-media-manager',
    schedule: '0 22 * * *',  // 4:00 PM CT — afternoon engagement check
    timezone: 'America/Chicago',
    task: 'engagement_report',
    payload: {},
    enabled: false,
  },

  // IT / M365 (reports to CTO)
  {
    id: 'm365-admin-weekly-audit',
    agentRole: 'm365-admin',
    schedule: '0 12 * * 1',     // Monday 7:00 AM CT — weekly channel + user audit
    timezone: 'America/Chicago',
    task: 'channel_audit',
    payload: {},
    enabled: false,
  },
  {
    id: 'm365-admin-user-audit',
    agentRole: 'm365-admin',
    schedule: '0 13 * * 1',     // Monday 8:00 AM CT — user access audit
    timezone: 'America/Chicago',
    task: 'user_audit',
    payload: {},
    enabled: false,
  },

  // Design sub-team (reports to VP-Design) — roles not in static crons
  // ui-ux-designer, frontend-engineer, design-critic, template-architect
  // These are added via DB-driven agent_schedules. See seed migration.

  // Platform Intelligence — Nexus fleet analysis (3x daily)
  {
    id: 'platform-intel-morning',
    agentRole: 'platform-intel',
    schedule: '0 7 * * *',      // 7:00 AM CT — morning analysis after batch eval
    timezone: 'America/Chicago',
    task: 'daily_analysis',
    payload: {},
    enabled: true,
  },
  {
    id: 'platform-intel-midday',
    agentRole: 'platform-intel',
    schedule: '0 12 * * *',     // 12:00 PM CT — midday check
    timezone: 'America/Chicago',
    task: 'daily_analysis',
    payload: {},
    enabled: true,
  },
  {
    id: 'platform-intel-evening',
    agentRole: 'platform-intel',
    schedule: '0 17 * * *',     // 5:00 PM CT — end-of-day sweep
    timezone: 'America/Chicago',
    task: 'daily_analysis',
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
  {
    id: 'sync-openai-billing',
    schedule: '0 9 * * *',     // 9:00 UTC = 3:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/openai-billing',
    enabled: true,
  },
  {
    id: 'sync-anthropic-billing',
    schedule: '0 9 * * *',     // 9:00 UTC = 3:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/anthropic-billing',
    enabled: true,
  },
  {
    id: 'sync-kling-billing',
    schedule: '0 9 * * *',     // 9:00 UTC = 3:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/kling-billing',
    enabled: true,
  },
  {
    id: 'sync-sharepoint-knowledge',
    schedule: '0 10 * * *',    // 10:00 UTC = 4:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/sync/sharepoint-knowledge',
    enabled: true,
  },
  // Heartbeat — lightweight agent check-ins (no Gemini calls, DB only)
  {
    id: 'heartbeat',
    schedule: '*/10 * * * *',  // every 10 minutes
    timezone: 'UTC',
    endpoint: '/heartbeat',
    enabled: true,
  },
  // Memory consolidation — daily raw→distilled memory promotion
  {
    id: 'memory-consolidation',
    schedule: '0 3 * * *',     // 3:00 UTC daily
    timezone: 'UTC',
    endpoint: '/memory/consolidate',
    enabled: true,
  },
  // Batch outcome evaluator — twice-daily quality scoring of task run outcomes
  {
    id: 'batch-outcome-eval',
    schedule: '0 2,14 * * *',  // 2:00 AM & 2:00 PM UTC
    timezone: 'UTC',
    endpoint: '/batch-eval/run',
    enabled: true,
  },
  // Cascade prediction evaluator — weekly calibration of prior Cascade Analysis calls
  {
    id: 'cascade-prediction-eval',
    schedule: '0 7 * * 1',     // Monday 7:00 AM UTC
    timezone: 'UTC',
    endpoint: '/cascade/evaluate',
    enabled: true,
  },
  // Canary evaluation — weekly executive orchestration rollout check
  {
    id: 'canary-evaluation',
    schedule: '0 8 * * 1',     // Monday 8:00 AM UTC — weekly canary eval
    timezone: 'UTC',
    endpoint: '/canary/evaluate',
    enabled: true,
  },
  // Agent knowledge-gap evaluator — weekly judge-scored readiness sweep
  {
    id: 'agent-knowledge-evals',
    schedule: '0 9 * * 1',     // Monday 9:00 AM UTC — weekly readiness eval
    timezone: 'UTC',
    endpoint: '/agent-evals/run',
    enabled: true,
  },
  // Memory archival — weekly TTL-based archival of expired raw traces
  {
    id: 'memory-archival',
    schedule: '0 4 * * 0',     // Sunday 4:00 UTC weekly
    timezone: 'UTC',
    endpoint: '/memory/archive',
    enabled: true,
  },
  // Tool expiration check — daily expiration of stale/unreliable dynamic tools
  {
    id: 'tool-expiration-check',
    schedule: '0 6 * * *',     // 6:00 UTC daily
    timezone: 'UTC',
    endpoint: '/tools/expire',
    enabled: true,
  },
  // GTM Readiness — daily Marketing Department pass/fail gate (runs after batch-eval)
  {
    id: 'gtm-readiness-eval',
    schedule: '0 13 * * *',    // 13:00 UTC = 8:00 AM CT, daily
    timezone: 'UTC',
    endpoint: '/gtm-readiness/run',
    enabled: true,
  },
  // Shadow eval dequeue — run pending challenger A/B tests after batch-eval
  {
    id: 'shadow-eval-pending',
    schedule: '0 15 * * *',    // 15:00 UTC = 10:00 AM CT, daily — after batch-eval + GTM
    timezone: 'UTC',
    endpoint: '/shadow-eval/run-pending',
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
