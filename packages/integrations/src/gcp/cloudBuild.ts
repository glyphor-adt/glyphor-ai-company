/**
 * GCP Cloud Build — List builds and retrieve build logs
 *
 * Gives Marcus (CTO) and the engineering team visibility into
 * Cloud Build CI/CD pipeline failures, statuses, and logs.
 *
 * API surface (Node `@google-cloud/cloudbuild` v3):
 * - **listBuilds**: `CloudBuildClient#listBuilds({ projectId, pageSize?, filter? })`
 *   → `projects.builds.list` with query params `projectId`, `pageSize`, `filter`.
 *   `filter` example: `status="FAILURE"` (omit when listing all).
 * - **getBuild**: `CloudBuildClient#getBuild({ name: "projects/{projectId}/locations/-/builds/{buildId}" })`
 *   → `projects.builds.get`; `locations/-` is the multi-region wildcard.
 */

import { CloudBuildClient } from '@google-cloud/cloudbuild';

let client: CloudBuildClient | null = null;

function getClient(): CloudBuildClient {
  if (!client) client = new CloudBuildClient();
  return client;
}

/** Resolve GCP project id for Cloud Build (Cloud Run / local). */
export function resolveGcpProjectIdForCloudBuild(): string | null {
  const raw =
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    '';
  return raw.length > 0 ? raw : null;
}

/** Matches google.devtools.cloudbuild.v1.Build.Status (REST enum names). */
const BUILD_STATUSES = new Set([
  'STATUS_UNKNOWN',
  'QUEUED',
  'WORKING',
  'SUCCESS',
  'FAILURE',
  'INTERNAL_ERROR',
  'TIMEOUT',
  'CANCELLED',
  'EXPIRED',
]);

/** Strip full resource name down to bare build id if needed. */
export function normalizeCloudBuildId(buildId: string): string {
  const trimmed = buildId.trim();
  const m = trimmed.match(/(?:^|\/)builds\/([^/]+)$/);
  return m ? m[1]! : trimmed;
}

export interface CloudBuildSummary {
  id: string;
  status: string;
  trigger?: string;
  startTime?: string;
  finishTime?: string;
  durationSec?: number;
  images: string[];
  logUrl?: string;
  failureInfo?: string;
}

export interface CloudBuildLog {
  buildId: string;
  status: string;
  logUrl?: string;
  steps: Array<{
    name: string;
    status: string;
    timing?: string;
  }>;
  failureInfo?: string;
  source?: string;
}

/** List recent Cloud Build builds for a project */
export async function listCloudBuilds(
  projectId: string,
  limit = 10,
  statusFilter?: string,
): Promise<CloudBuildSummary[]> {
  const pid = (projectId || resolveGcpProjectIdForCloudBuild() || '').trim();
  if (!pid) {
    throw new Error(
      'Cloud Build: missing project id. Set GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT).',
    );
  }

  const cb = getClient();
  let filter: string | undefined;
  if (statusFilter && String(statusFilter).trim()) {
    const s = String(statusFilter).trim();
    if (!BUILD_STATUSES.has(s)) {
      throw new Error(
        `Cloud Build: invalid status filter "${s}". Use one of: ${[...BUILD_STATUSES].join(', ')}`,
      );
    }
    filter = `status="${s}"`;
  }

  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));

  const [builds] = await cb.listBuilds({
    projectId: pid,
    pageSize,
    filter,
  });

  return (builds ?? []).map((b) => {
    const startSec = Number(b.startTime?.seconds ?? 0);
    const finishSec = Number(b.finishTime?.seconds ?? 0);
    return {
      id: b.id ?? 'unknown',
      status: String(b.status ?? 'UNKNOWN'),
      trigger: b.buildTriggerId ?? undefined,
      startTime: startSec ? new Date(startSec * 1000).toISOString() : undefined,
      finishTime: finishSec ? new Date(finishSec * 1000).toISOString() : undefined,
      durationSec: startSec && finishSec ? finishSec - startSec : undefined,
      images: (b.images ?? []) as string[],
      logUrl: b.logUrl ?? undefined,
      failureInfo: b.failureInfo?.detail ?? undefined,
    };
  });
}

/** Get detailed info and step logs for a specific build */
export async function getCloudBuildDetails(
  projectId: string,
  buildId: string,
): Promise<CloudBuildLog> {
  const pid = (projectId || resolveGcpProjectIdForCloudBuild() || '').trim();
  if (!pid) {
    throw new Error(
      'Cloud Build: missing project id. Set GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT).',
    );
  }
  const bareId = normalizeCloudBuildId(buildId);
  if (!bareId) {
    throw new Error('Cloud Build: build_id is empty after normalization.');
  }

  const cb = getClient();
  const resourceName = `projects/${pid}/locations/-/builds/${bareId}`;
  const [build] = await cb.getBuild({
    name: resourceName,
  });

  const steps = (build.steps ?? []).map((step) => {
    const startSec = Number(step.timing?.startTime?.seconds ?? 0);
    const endSec = Number(step.timing?.endTime?.seconds ?? 0);
    return {
      name: step.name ?? 'unknown',
      status: String(step.status ?? 'UNKNOWN'),
      timing: startSec && endSec ? `${endSec - startSec}s` : undefined,
    };
  });

  return {
    buildId: build.id ?? bareId,
    status: String(build.status ?? 'UNKNOWN'),
    logUrl: build.logUrl ?? undefined,
    steps,
    failureInfo: build.failureInfo?.detail ?? undefined,
    source: build.source?.repoSource?.repoName ?? build.source?.storageSource?.bucket ?? undefined,
  };
}
