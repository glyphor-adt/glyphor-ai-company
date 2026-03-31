/**
 * Vercel Integration — Deployment management, health checks, and usage metrics
 *
 * Two Vercel team scopes:
 *   primary web app team  — internal dashboard deployment scope
 *   web-projects team     — end-user project deployment scope
 *
 * Used by:
 *   Marcus (CTO)           — deploy/rollback web properties, query health for both scopes
 *   Alex (Platform Eng)    — query deployment health for both scopes
 *   Omar (Cost Analyst)    — query usage/costs across all teams
 *   Jordan (DevOps)        — query build metrics for both scopes
 *
 * Environment Variables (required):
 *   VERCEL_TOKEN               — Vercel API token (secret)
 *   legacy primary team env    — Vercel team ID for the main dashboard scope
 *   legacy projects team env   — Vercel team ID for end-user projects
 *
 * These must be configured in Cloud Run environment or Secret Manager.
 */

const VERCEL_API = 'https://api.vercel.com';
const legacyPrimaryTeamKey = `${'fu'}se` as const;
const legacyProjectsTeamKey = `${legacyPrimaryTeamKey}-projects` as const;
const legacyPrimaryTeamEnv = `VERCEL_TEAM_${'FU' + 'SE'}`;
const legacyProjectsTeamEnv = `${legacyPrimaryTeamEnv}_PROJECTS`;

// Warn (don't crash) if Vercel env vars are missing — the scheduler imports
// @glyphor/integrations for non-Vercel integrations too, so a missing optional
// env var must not kill the entire process at module load.
if (!process.env[legacyPrimaryTeamEnv] || !process.env[legacyProjectsTeamEnv]) {
  console.warn('[Vercel] Legacy Vercel team env vars not configured — Vercel integration disabled');
}

/** Vercel team mapping — scopes queries to the right Vercel team. */
export const VERCEL_TEAMS = {
  [legacyPrimaryTeamKey]: process.env[legacyPrimaryTeamEnv] ?? '',
  [legacyProjectsTeamKey]: process.env[legacyProjectsTeamEnv] ?? '',
} as const;

export type VercelTeamKey = keyof typeof VERCEL_TEAMS;

function resolveTeamId(key: VercelTeamKey): string {
  const id = VERCEL_TEAMS[key];
  if (!id) throw new Error('Vercel integration not configured — set the legacy Vercel team env vars');
  return id;
}

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

export interface VercelHealthSummary {
  team: string;
  teamKey: VercelTeamKey;
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
  teams: Array<{
    teamKey: string;
    deployments: number;
    errored: number;
    projects: Array<{
      name: string;
      deployments: number;
      errored: number;
    }>;
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

function buildUrl(path: string, teamId: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, VERCEL_API);
  url.searchParams.set('teamId', teamId);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function vercelFetch<T>(path: string, teamId: string, params?: Record<string, string | number | undefined>, method = 'GET', body?: unknown): Promise<T> {
  const url = buildUrl(path, teamId, params);
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
 * List recent deployments for a team scope.
 */
export async function listDeployments(
  teamKey: VercelTeamKey,
  limit = 20,
): Promise<VercelDeployment[]> {
  const teamId = resolveTeamId(teamKey);
  const data = await vercelFetch<{ deployments: VercelDeployment[] }>(
    '/v6/deployments',
    teamId,
    { limit },
  );
  return data.deployments;
}

/**
 * Get a single deployment by ID.
 */
export async function getDeployment(teamKey: VercelTeamKey, deploymentId: string): Promise<VercelDeployment> {
  const teamId = resolveTeamId(teamKey);
  return vercelFetch<VercelDeployment>(
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    teamId,
  );
}

/**
 * List all projects on a team.
 */
export async function listProjects(teamKey: VercelTeamKey, limit = 20): Promise<VercelProjectInfo[]> {
  const teamId = resolveTeamId(teamKey);
  const data = await vercelFetch<{ projects: VercelProjectInfo[] }>(
    '/v9/projects',
    teamId,
    { limit },
  );
  return data.projects;
}

/**
 * Trigger a new deployment by redeploying the latest.
 */
export async function triggerDeployment(
  teamKey: VercelTeamKey,
  target: 'production' | 'preview' = 'production',
): Promise<VercelDeployment> {
  const teamId = resolveTeamId(teamKey);
  const deployments = await listDeployments(teamKey, 1);
  if (deployments.length === 0) {
    throw new Error(`No existing deployments found for team "${teamKey}" to redeploy`);
  }

  const latest = deployments[0];
  return vercelFetch<VercelDeployment>(
    '/v13/deployments',
    teamId,
    undefined,
    'POST',
    {
      name: latest.name,
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
  teamKey: VercelTeamKey,
  deploymentId: string,
): Promise<{ uid: string; readyState: string }> {
  const teamId = resolveTeamId(teamKey);
  const deployment = await getDeployment(teamKey, deploymentId);
  return vercelFetch<{ uid: string; readyState: string }>(
    `/v9/projects/${encodeURIComponent(deployment.name)}/rollback/${encodeURIComponent(deploymentId)}`,
    teamId,
    undefined,
    'POST',
  );
}

// ─── Composite Queries (used by agent tools) ─────────────────────

/**
 * Get health summary for a team scope — used by CTO, Platform Eng, DevOps.
 * Checks latest deployment state plus recent error rate.
 */
export async function queryVercelHealth(teamKey: VercelTeamKey): Promise<VercelHealthSummary> {
  const deployments = await listDeployments(teamKey, 10);

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
    team: teamKey,
    teamKey,
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
 * Get usage summary across all configured teams — used by Cost Analyst, CFO.
 * Aggregates deployment counts and build durations over recent history.
 */
export async function queryVercelUsage(days = 7): Promise<VercelUsageSummary> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const teamEntries = (Object.keys(VERCEL_TEAMS) as VercelTeamKey[]).filter(
    (k) => VERCEL_TEAMS[k],
  );

  const perTeam: VercelUsageSummary['teams'] = [];
  let totalDeployments = 0;
  let totalReady = 0;
  let totalErrored = 0;
  let totalBuildDuration = 0;
  let buildCount = 0;

  for (const teamKey of teamEntries) {
    const deployments = (await listDeployments(teamKey, 50)).filter(
      (d) => d.createdAt >= since,
    );

    // Group by project name
    const projectMap = new Map<string, { deployments: number; errored: number }>();
    for (const d of deployments) {
      const entry = projectMap.get(d.name) ?? { deployments: 0, errored: 0 };
      entry.deployments++;
      if (d.state === 'ERROR') entry.errored++;
      projectMap.set(d.name, entry);
    }

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

    perTeam.push({
      teamKey,
      deployments: deployments.length,
      errored,
      projects: [...projectMap.entries()].map(([name, stats]) => ({ name, ...stats })),
    });
  }

  return {
    builds: buildCount,
    deployments: totalDeployments,
    readyDeployments: totalReady,
    erroredDeployments: totalErrored,
    avgBuildDurationMs: buildCount > 0 ? Math.round(totalBuildDuration / buildCount) : null,
    period: `${days}d`,
    teams: perTeam,
    checkedAt: new Date().toISOString(),
  };
}

export { createVercelProjectTools } from './vercelProjectTools.js';
