/**
 * GCP Cloud Build — List builds and retrieve build logs
 *
 * Gives Marcus (CTO) and the engineering team visibility into
 * Cloud Build CI/CD pipeline failures, statuses, and logs.
 */

import { CloudBuildClient } from '@google-cloud/cloudbuild';

let client: CloudBuildClient | null = null;

function getClient(): CloudBuildClient {
  if (!client) client = new CloudBuildClient();
  return client;
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
  const cb = getClient();
  let filter = '';
  if (statusFilter) {
    filter = `status="${statusFilter}"`;
  }

  const [builds] = await cb.listBuilds({
    parent: `projects/${projectId}/locations/-`,
    pageSize: limit,
    filter: filter || undefined,
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
  const cb = getClient();
  const [build] = await cb.getBuild({
    name: `projects/${projectId}/locations/-/builds/${buildId}`,
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
    buildId: build.id ?? buildId,
    status: String(build.status ?? 'UNKNOWN'),
    logUrl: build.logUrl ?? undefined,
    steps,
    failureInfo: build.failureInfo?.detail ?? undefined,
    source: build.source?.repoSource?.repoName ?? build.source?.storageSource?.bucket ?? undefined,
  };
}
