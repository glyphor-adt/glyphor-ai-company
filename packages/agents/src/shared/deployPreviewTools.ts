/**
 * Deploy Preview Tools — Preview deployment management
 *
 * Tools:
 *   deploy_preview        — Trigger preview deployment for design branch
 *   get_deployment_status — Check deployment status
 *   list_deployments      — List recent deployments
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  listDeployments as listVercelDeployments,
  triggerDeployment,
  queryVercelHealth,
  VERCEL_TEAMS,
  type VercelTeamKey,
} from '@glyphor/integrations';

const VALID_PROJECTS = ['dashboard', 'pulse'] as const;
type Project = (typeof VALID_PROJECTS)[number];

const primaryVercelTeam = `${'fu'}se` as const;
const webProjectsVercelTeam = `${primaryVercelTeam}-projects` as const;

const PROJECT_TEAM_MAP: Record<Project, VercelTeamKey> = {
  dashboard: primaryVercelTeam,
  pulse: webProjectsVercelTeam,
};

function resolveTeam(project: Project): VercelTeamKey {
  return PROJECT_TEAM_MAP[project];
}

function isValidProject(value: unknown): value is Project {
  return typeof value === 'string' && VALID_PROJECTS.includes(value as Project);
}

export function createDeployPreviewTools(): ToolDefinition[] {
  return [
    // ── deploy_preview ──────────────────────────────────────────────────
    {
      name: 'deploy_preview',
      description:
        'Trigger a preview deployment for a design branch. Branch must start with "feature/design-".',
      parameters: {
        branch: {
          type: 'string',
          description: 'Git branch to deploy (must start with "feature/design-")',
          required: true,
        },
        project: {
          type: 'string',
          description: 'Target project (default: dashboard)',
          required: false,
          enum: ['dashboard', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const branch = params.branch as string | undefined;
        if (!branch || typeof branch !== 'string') {
          return { success: false, error: 'Parameter "branch" is required.' };
        }

        if (!branch.startsWith('feature/design-')) {
          return {
            success: false,
            error:
              'Branch must start with "feature/design-". Only design branches may be preview-deployed.',
          };
        }

        const project: Project =
          isValidProject(params.project) ? params.project : 'dashboard';
        const team = resolveTeam(project);

        // Attempt deployment via integrations helper
        try {
          const deployment = await triggerDeployment(team, 'preview');
          return {
            success: true,
            data: {
              deploymentId: deployment.uid,
              url: deployment.url,
              state: deployment.state,
              branch,
              project,
              createdAt: new Date(deployment.createdAt).toISOString(),
            },
          };
        } catch {
          // Fall back to deploy hook if triggerDeployment fails
        }

        // Fallback: Vercel deploy hook
        const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
        if (!hookUrl) {
          return {
            success: false,
            error:
              'Deployment failed and VERCEL_DEPLOY_HOOK_URL is not configured. Cannot trigger preview.',
          };
        }

        try {
          const res = await fetch(`${hookUrl}?ref=${encodeURIComponent(branch)}`, {
            method: 'POST',
          });

          if (!res.ok) {
            return {
              success: false,
              error: `Deploy hook returned HTTP ${res.status}: ${await res.text()}`,
            };
          }

          const body = (await res.json()) as Record<string, unknown>;
          return {
            success: true,
            data: {
              deploymentId: body.id ?? body.uid ?? null,
              url: body.url ?? null,
              state: 'QUEUED',
              branch,
              project,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to trigger deploy hook: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── get_deployment_status ───────────────────────────────────────────
    {
      name: 'get_deployment_status',
      description:
        'Check the status of a deployment. Provide a deployment_id for a specific deployment, or a project to get the latest health summary.',
      parameters: {
        deployment_id: {
          type: 'string',
          description: 'Specific Vercel deployment ID to check',
          required: false,
        },
        project: {
          type: 'string',
          description: 'Project to check health for (default: dashboard)',
          required: false,
          enum: ['dashboard', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const project: Project =
          isValidProject(params.project) ? params.project : 'dashboard';
        const team = resolveTeam(project);
        const deploymentId = params.deployment_id as string | undefined;

        // If a specific deployment_id is provided, look it up in recent deployments
        if (deploymentId) {
          try {
            const deployments = await listVercelDeployments(team, 50);
            const match = deployments.find((d) => d.uid === deploymentId);
            if (!match) {
              return {
                success: false,
                error: `Deployment "${deploymentId}" not found in recent deployments for project "${project}".`,
              };
            }

            const buildTime =
              match.readyAt && match.buildingAt
                ? Math.round((match.readyAt - match.buildingAt) / 1000)
                : null;

            return {
              success: true,
              data: {
                deploymentId: match.uid,
                status: match.state,
                url: match.url,
                inspectorUrl: match.inspectorUrl,
                target: match.target,
                buildTimeSeconds: buildTime,
                createdAt: new Date(match.createdAt).toISOString(),
                readyAt: match.readyAt
                  ? new Date(match.readyAt).toISOString()
                  : null,
              },
            };
          } catch (err) {
            return {
              success: false,
              error: `Failed to fetch deployment: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }

        // No deployment_id — return overall health summary
        try {
          const health = await queryVercelHealth(team);
          return {
            success: true,
            data: {
              project,
              status: health.status,
              latestDeployment: health.latestDeployment
                ? {
                    deploymentId: health.latestDeployment.uid,
                    url: health.latestDeployment.url,
                    state: health.latestDeployment.state,
                    createdAt: new Date(
                      health.latestDeployment.createdAt,
                    ).toISOString(),
                  }
                : null,
              recentDeployments: health.recentDeployments,
              checkedAt: health.checkedAt,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to query deployment health: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── list_deployments ────────────────────────────────────────────────
    {
      name: 'list_deployments',
      description:
        'List recent deployments for a project. Returns deployment id, status, URL, branch, and creation time.',
      parameters: {
        project: {
          type: 'string',
          description: 'Project to list deployments for (default: dashboard)',
          required: false,
          enum: ['dashboard', 'pulse'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of deployments to return (default: 10)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        const project: Project =
          isValidProject(params.project) ? params.project : 'dashboard';
        const team = resolveTeam(project);
        const limit =
          typeof params.limit === 'number' && params.limit > 0
            ? Math.min(params.limit, 100)
            : 10;

        try {
          const deployments = await listVercelDeployments(team, limit);

          const items = deployments.map((d) => ({
            deploymentId: d.uid,
            status: d.state,
            url: d.url,
            branch: d.meta?.githubCommitRef ?? null,
            target: d.target,
            creator: d.creator?.username ?? null,
            createdAt: new Date(d.createdAt).toISOString(),
          }));

          return {
            success: true,
            data: { project, total: items.length, deployments: items },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to list deployments: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
