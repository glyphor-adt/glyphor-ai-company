/**
 * Cron Manager — Cloud Scheduler configuration and local cron execution
 *
 * Defines scheduled jobs for each agent and handles their execution.
 * In production, these map to GCP Cloud Scheduler → Pub/Sub → Cloud Run.
 * Locally, this module can run jobs directly via the event router.
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { isCanonicalKeepRole } from '@glyphor/shared';

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
    id: 'cfo-daily-costs',
    agentRole: 'cfo',
    schedule: '0 14 * * *',  // 9:00 AM CT, daily
    timezone: 'America/Chicago',
    task: 'daily_cost_check',
    payload: {},
    enabled: true,
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
  // Memory consolidation — daily raw→distilled promotion (memoryConsolidator) +
  // optional Nexus fleet-memory pass (AUTO_MEMORY_AGENT_CONSOLIDATION, gated).
  {
    id: 'memory-consolidation',
    schedule: '0 3 * * *',     // 3:00 UTC daily
    timezone: 'UTC',
    endpoint: '/memory/consolidate',
    enabled: true,
  },
  // Agent dream consolidation — per-agent cross-session pattern extraction.
  // Runs after memory consolidation to update individual world models and
  // procedural memory with skill learnings and recurring failure patterns.
  {
    id: 'agent-dream-consolidation',
    schedule: '30 3 * * *',    // 3:30 UTC daily (after memory consolidation)
    timezone: 'UTC',
    endpoint: '/memory/agent-dream',
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
  {
    id: 'autonomy-daily-eval',
    schedule: '0 4 * * *',     // 4:00 AM UTC daily
    timezone: 'UTC',
    endpoint: '/autonomy/evaluate-daily',
    enabled: true,
  },
  // Prediction journal resolver — nightly resolution of due forecast records
  {
    id: 'prediction-journal-resolver',
    schedule: '0 5 * * *',     // 5:00 AM UTC daily
    timezone: 'UTC',
    endpoint: '/predictions/resolve',
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
  // Planning-gate monitor — daily quality regression alert check
  {
    id: 'planning-gate-monitor',
    schedule: '0 7 * * *',     // 7:00 AM UTC daily
    timezone: 'UTC',
    endpoint: '/planning-gate/monitor',
    enabled: true,
  },
  // Trust quality monitor — daily evidence tier and claim fabrication alert check
  {
    id: 'trust-quality-monitor',
    schedule: '15 7 * * *',    // 7:15 AM UTC daily (after planning-gate)
    timezone: 'UTC',
    endpoint: '/trust/monitor',
    enabled: true,
  },
  // Economics guardrails — daily Teams notify when ECONOMICS_ALERT_* thresholds breach
  {
    id: 'economics-guardrail-notify',
    schedule: '30 7 * * *',    // 7:30 AM UTC daily (after planning-gate rollup)
    timezone: 'UTC',
    endpoint: '/economics/guardrail-notify',
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
  // Golden-task suite — weekly contract eval (scenario_name golden:%)
  {
    id: 'golden-eval-suite',
    schedule: '30 10 * * 3',   // Wednesday 10:30 AM UTC — Stage 3 quality loop
    timezone: 'UTC',
    endpoint: '/agent-evals/run-golden',
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
  // GTM Readiness — daily Marketing gate (8:00 AM America/Chicago ≈ 13:00 UTC during CDT)
  // Scheduled after the morning batch-eval window (02:00 UTC); see batch-outcome-eval above.
  {
    id: 'gtm-readiness-eval',
    schedule: '0 13 * * *',
    timezone: 'UTC',
    endpoint: '/gtm-readiness/run',
    enabled: true,
  },
  // Tool health testing — daily run of all 3 tiers
  {
    id: 'tool-health-check',
    schedule: '0 6 * * *',     // 6:00 AM UTC daily
    timezone: 'UTC',
    endpoint: '/tool-health/run',
    enabled: true,
  },
  // Model checker — monthly provider/model drift audit
  {
    id: 'glyphor-model-checker',
    schedule: '0 9 1 * *',     // 9:00 AM UTC on the 1st of each month
    timezone: 'UTC',
    endpoint: '/internal/model-check',
    enabled: true,
  },
  // Shadow eval dequeue — pending challenger A/B tests (queueShadowEvaluation → run-pending)
  // Every 6h so work is picked up regularly after batch-eval cycles (02:00 / 14:00 UTC).
  {
    id: 'shadow-eval-pending',
    schedule: '0 */6 * * *',
    timezone: 'UTC',
    endpoint: '/shadow-eval/run-pending',
    enabled: true,
  },
];

/**
 * Get all enabled scheduled jobs.
 */
export function getEnabledJobs(): ScheduledJob[] {
  return SCHEDULED_JOBS.filter((job) => job.enabled && isCanonicalKeepRole(job.agentRole));
}

/**
 * Get scheduled jobs for a specific agent.
 */
export function getJobsForAgent(role: CompanyAgentRole): ScheduledJob[] {
  if (!isCanonicalKeepRole(role)) return [];
  return SCHEDULED_JOBS.filter((job) => job.agentRole === role);
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
  oidcServiceAccountEmail?: string,
): string[] {
  const schedulerOidcServiceAccount = oidcServiceAccountEmail ?? `${projectId}@appspot.gserviceaccount.com`;

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
      `--oidc-service-account-email="${schedulerOidcServiceAccount}"`,
    ].join(' \\\n  ');
  });

  return [...agentJobs, ...syncJobs];
}
