/**
 * Vercel Integration — Deployment management, health checks, and usage metrics
 *
 * Used by:
 *   Marcus (CTO)           — trigger/rollback deploys, query health
 *   Alex (Platform Eng)    — query deployment health
 *   Omar (Cost Analyst)    — query usage/bandwidth costs
 *   Jordan (DevOps)        — query build metrics
 *
 * Requires VERCEL_TOKEN secret (scoped to team).
 * Optional VERCEL_TEAM_ID for team-scoped operations.
 */

const VERCEL_API = 'https://api.vercel.com';

/** Vercel project mapping — matches our product names to Vercel project IDs/names. */
export const VERCEL_PROJECTS = {
  fuse: process.env.VERCEL_PROJECT_FUSE || 'fuse',
  pulse: process.env.VERCEL_PROJECT_PULSE || 'pulse',
} as const;

export type VercelProject = keyof typeof VERCEL_PROJECTS;

// ─── Interfaces ──────────────────────────────────────────────────

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  target: string | null;
  createdAt: number;
  readyAt: number | null;
  buildingAt: number | null;
  creator: { username: string };
  meta?: Record<string, string>;
  inspectorUrl: string;
}

export interface VercelProjectInfo {
  id: string;
  name: string;
  framework: string | null;
  nodeVersion: string;
  updatedAt: number;
  latestDeployments: Array<{
    uid: string;
    state: string;
    createdAt: number;
    url: string;
  }>;
}

export interface VercelDomainInfo {
  name: string;
  verified: boolean;
  redirect: string | null;
}

export interface VercelHealthSummary {
  project: string;
  status: 'healthy' | 'building' | 'error' | 'unknown';
  latestDeployment: VercelDeployment | null;
  recentDeployments: {
    total: number;
    ready: number;
    errored: number;
    cancelled: number;
  };
  checkedAt: string;
}

export interface VercelUsageSummary {
  builds: number;
  deployments: number;
  readyDeployments: number;
  erroredDeployments: number;
  avgBuildDurationMs: number | null;
  period: string;
  projects: Array<{
    name: string;
    deployments: number;
    errored: number;
  }>;
  checkedAt: string;
}

// ─── HTTP Client ─────────────────────────────────────────────────

function getHeaders(): Record<string, string> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN not configured — add the secret to Cloud Run');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `teamId=${encodeURIComponent(teamId)}` : '';
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, VERCEL_API);
  const tq = teamQuery();
  if (tq) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID!);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function vercelFetch<T>(path: string, params?: Record<string, string | number | undefined>, method = 'GET', body?: unknown): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method,
    headers: getHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vercel API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── API Functions ───────────────────────────────────────────────

/**
 * List recent deployments, optionally filtered by project.
 */
export async function listDeployments(
  projectKey?: VercelProject,
  limit = 20,
): Promise<VercelDeployment[]> {
  const params: Record<string, string | number | undefined> = { limit };
  if (projectKey) {
    params.projectId = VERCEL_PROJECTS[projectKey];
  }
  const data = await vercelFetch<{ deployments: VercelDeployment[] }>(
    '/v6/deployments',
    params,
  );
  return data.deployments;
}

/**
 * Get a single deployment by ID.
 */
export async function getDeployment(deploymentId: string): Promise<VercelDeployment> {
  return vercelFetch<VercelDeployment>(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
}

/**
 * List all projects on the team.
 */
export async function listProjects(limit = 20): Promise<VercelProjectInfo[]> {
  const data = await vercelFetch<{ projects: VercelProjectInfo[] }>(
    '/v9/projects',
    { limit },
  );
  return data.projects;
}

/**
 * Get details for a specific project.
 */
export async function getProjectInfo(projectKey: VercelProject): Promise<VercelProjectInfo> {
  const projectId = VERCEL_PROJECTS[projectKey];
  return vercelFetch<VercelProjectInfo>(
    `/v9/projects/${encodeURIComponent(projectId)}`,
  );
}

/**
 * Get domains for a project.
 */
export async function getProjectDomains(projectKey: VercelProject): Promise<VercelDomainInfo[]> {
  const projectId = VERCEL_PROJECTS[projectKey];
  const data = await vercelFetch<{ domains: VercelDomainInfo[] }>(
    `/v9/projects/${encodeURIComponent(projectId)}/domains`,
  );
  return data.domains;
}

/**
 * Trigger a new deployment by redeploying the latest.
 * This creates a new deployment from the latest source.
 */
export async function triggerDeployment(
  projectKey: VercelProject,
  target: 'production' | 'preview' = 'production',
): Promise<VercelDeployment> {
  const projectId = VERCEL_PROJECTS[projectKey];

  // Get the latest production deployment to redeploy from
  const deployments = await listDeployments(projectKey, 1);
  if (deployments.length === 0) {
    throw new Error(`No existing deployments found for project "${projectKey}" to redeploy`);
  }

  const latest = deployments[0];
  return vercelFetch<VercelDeployment>(
    '/v13/deployments',
    undefined,
    'POST',
    {
      name: projectId,
      deploymentId: latest.uid,
      target,
      meta: { triggeredBy: 'glyphor-agent' },
    },
  );
}

/**
 * Rollback to a previous deployment by promoting it.
 */
export async function rollbackDeployment(
  projectKey: VercelProject,
  deploymentId: string,
): Promise<{ uid: string; readyState: string }> {
  const projectId = VERCEL_PROJECTS[projectKey];
  return vercelFetch<{ uid: string; readyState: string }>(
    `/v9/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`,
    undefined,
    'POST',
  );
}

// ─── Composite Queries (used by agent tools) ─────────────────────

/**
 * Get health summary for a project — used by CTO, Platform Eng, DevOps.
 * Checks latest deployment state plus recent error rate.
 */
export async function queryVercelHealth(projectKey: VercelProject): Promise<VercelHealthSummary> {
  const deployments = await listDeployments(projectKey, 10);

  const latest = deployments[0] ?? null;
  const ready = deployments.filter((d) => d.state === 'READY').length;
  const errored = deployments.filter((d) => d.state === 'ERROR').length;
  const cancelled = deployments.filter((d) => d.state === 'CANCELED').length;

  let status: VercelHealthSummary['status'] = 'unknown';
  if (latest) {
    if (latest.state === 'READY') status = 'healthy';
    else if (latest.state === 'BUILDING' || latest.state === 'INITIALIZING') status = 'building';
    else if (latest.state === 'ERROR') status = 'error';
  }

  return {
    project: VERCEL_PROJECTS[projectKey],
    status,
    latestDeployment: latest,
    recentDeployments: {
      total: deployments.length,
      ready,
      errored,
      cancelled,
    },
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Get usage summary across all projects — used by Cost Analyst, CFO.
 * Aggregates deployment counts and build durations over recent history.
 */
export async function queryVercelUsage(days = 7): Promise<VercelUsageSummary> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const projects = await listProjects();


  const perProject: VercelUsageSummary['projects'] = [];
  let totalDeployments = 0;
  let totalReady = 0;
  let totalErrored = 0;
  let totalBuildDuration = 0;
  let buildCount = 0;

  for (const project of projects) {
    const deployments = await listDeployments(
      // Check if it maps to a known key; otherwise skip
      undefined,
      50,
    ).then((ds) =>
      ds.filter((d) => d.name === project.name && d.createdAt >= since),
    );

    const ready = deployments.filter((d) => d.state === 'READY').length;
    const errored = deployments.filter((d) => d.state === 'ERROR').length;

    for (const d of deployments) {
      if (d.readyAt && d.buildingAt) {
        totalBuildDuration += d.readyAt - d.buildingAt;
        buildCount++;
      }
    }

    totalDeployments += deployments.length;
    totalReady += ready;
    totalErrored += errored;

    perProject.push({
      name: project.name,
      deployments: deployments.length,
      errored,
    });
  }

  return {
    builds: buildCount,
    deployments: totalDeployments,
    readyDeployments: totalReady,
    erroredDeployments: totalErrored,
    avgBuildDurationMs: buildCount > 0 ? Math.round(totalBuildDuration / buildCount) : null,
    period: `${days}d`,
    projects: perProject,
    checkedAt: new Date().toISOString(),
  };
}
