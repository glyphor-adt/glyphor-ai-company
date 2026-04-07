/**
 * Data Sync Scheduler — Fires DATA_SYNC_JOBS on their cron schedule
 *
 * In production GCP Cloud Scheduler hits these HTTP endpoints externally.
 * This scheduler fires them internally so syncs also run when
 * Cloud Scheduler jobs haven't been provisioned yet.
 */

import { GoogleAuth } from 'google-auth-library';
import { getEnabledSyncJobs } from './cronManager.js';

const googleAuth = new GoogleAuth();

/**
 * The audience used when requesting OIDC tokens for self-calls to internal routes.
 * Must be the public Cloud Run URL so the token audience matches what
 * requireInternalAuth() validates against (SCHEDULER_OIDC_AUDIENCE takes priority).
 */
const SCHEDULER_SELF_URL = (
  process.env.SCHEDULER_OIDC_AUDIENCE ??
  process.env.SCHEDULER_SERVICE_URL ??
  process.env.SCHEDULER_URL
)?.replace(/\/$/, '');

// Inline cron matcher (same logic as DynamicScheduler)
function cronMatchesNow(expression: string, now: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const fields = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];

  return parts.every((part, i) => fieldMatches(part, fields[i]));
}

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;
  return field.split(',').some((segment) => {
    if (segment.includes('/')) {
      const [range, stepStr] = segment.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;
      if (range === '*') return value % step === 0;
      if (range.includes('-')) {
        const [minStr, maxStr] = range.split('-');
        return value >= parseInt(minStr, 10) && value <= parseInt(maxStr, 10) && (value - parseInt(minStr, 10)) % step === 0;
      }
      return false;
    }
    if (segment.includes('-')) {
      const [minStr, maxStr] = segment.split('-');
      return value >= parseInt(minStr, 10) && value <= parseInt(maxStr, 10);
    }
    return parseInt(segment, 10) === value;
  });
}

export class DataSyncScheduler {
  private port: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = -1;
  private runInitialSync: boolean;

  constructor(port: number, options?: { runInitialSync?: boolean }) {
    this.port = port;
    this.runInitialSync = options?.runInitialSync ?? true;
  }

  start(): void {
    if (this.intervalId) return;
    console.log('[DataSyncScheduler] Started — will fire data sync jobs on cron schedule');

    this.intervalId = setInterval(() => this.tick(), 60_000);

    // Fire all sync jobs once on startup so data is populated immediately
    if (this.runInitialSync) {
      console.log('[DataSyncScheduler] Running initial sync for all enabled jobs...');
      this.fireAll();
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[DataSyncScheduler] Stopped');
    }
  }

  /** Fire all enabled sync jobs (used on startup). */
  private async fireAll(): Promise<void> {
    const jobs = getEnabledSyncJobs();
    for (const job of jobs) {
      this.fireEndpoint(job.id, job.endpoint);
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (currentMinute === this.lastCheckMinute) return;
    this.lastCheckMinute = currentMinute;

    const jobs = getEnabledSyncJobs();
    for (const job of jobs) {
      if (cronMatchesNow(job.schedule, now)) {
        this.fireEndpoint(job.id, job.endpoint);
      }
    }
  }

  private async fireEndpoint(jobId: string, endpoint: string): Promise<void> {
    try {
      console.log(`[DataSyncScheduler] Firing ${jobId} → POST ${endpoint}`);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (SCHEDULER_SELF_URL) {
        // Obtain an OIDC id-token for the scheduler's own public URL. This satisfies
        // requireInternalAuth() which validates Bearer tokens on internal-service-only routes.
        const idTokenClient = await googleAuth.getIdTokenClient(SCHEDULER_SELF_URL);
        const authHeaders = await idTokenClient.getRequestHeaders();
        Object.assign(headers, authHeaders);
      } else {
        console.warn(
          '[DataSyncScheduler] No SCHEDULER_OIDC_AUDIENCE / SCHEDULER_SERVICE_URL / SCHEDULER_URL set — ' +
            'internal self-calls will lack a Bearer token and may receive 401.',
        );
      }
      const res = await fetch(`http://localhost:${this.port}${endpoint}`, {
        method: 'POST',
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[DataSyncScheduler] ${jobId} completed:`, body);
      } else {
        console.warn(`[DataSyncScheduler] ${jobId} failed (${res.status}):`, body);
      }
    } catch (err) {
      console.error(`[DataSyncScheduler] ${jobId} error:`, (err as Error).message);
    }
  }
}
