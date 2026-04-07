import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getWebsitePipelineOrg, requireWebsitePipelineEnv, resolveWebsitePipelineEnv } from '../websitePipelineEnv.js';

const VERCEL_API = 'https://api.vercel.com';
const GITHUB_ORG = getWebsitePipelineOrg();

function getVercelToken(): string {
  return requireWebsitePipelineEnv('vercel-token');
}

function getTeamId(): string | undefined {
  return resolveWebsitePipelineEnv('vercel-team-id');
}

async function vercelRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = new URL(`${VERCEL_API}${path}`);
  const teamId = getTeamId();
  if (teamId) url.searchParams.set('teamId', teamId);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${getVercelToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

export function createVercelProjectTools(): ToolDefinition[] {
  return [
    {
      name: 'vercel_create_project',
      description: 'Create a Vercel project linked to a GitHub repository.',
      parameters: {
        repo_name: {
          type: 'string',
          description: 'GitHub repository name.',
          required: true,
        },
        project_name: {
          type: 'string',
          description: 'Optional display name for the Vercel project.',
          required: false,
        },
        framework: {
          type: 'string',
          description: 'Framework preset. Defaults to vite.',
          required: false,
        },
        github_org: {
          type: 'string',
          description: `GitHub org owning the repo. Defaults to ${GITHUB_ORG}.`,
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoName = String(params.repo_name ?? '').trim();
        if (!repoName) return { success: false, error: 'repo_name is required.' };

        const projectName = String(params.project_name ?? repoName).trim();
        const framework = String(params.framework ?? 'vite').trim();
        const githubOrg = String(params.github_org ?? GITHUB_ORG).trim();

        try {
          const { ok, status, data } = await vercelRequest(
            '/v10/projects',
            'POST',
            {
              name: projectName,
              framework,
              gitRepository: {
                type: 'github',
                repo: `${githubOrg}/${repoName}`,
              },
              buildCommand: 'npm run build',
              outputDirectory: 'dist',
              installCommand: 'npm install',
            },
            ctx.abortSignal,
          );

          if (!ok) {
            const err = data as Record<string, unknown>;
            return {
              success: false,
              error: `Vercel API error (${status}): ${String((err.error as Record<string, unknown> | undefined)?.message ?? 'Unknown Vercel error')}`,
            };
          }

          const project = data as Record<string, unknown>;
          const name = String(project.name ?? projectName);
          return {
            success: true,
            data: {
              project_id: String(project.id ?? ''),
              project_name: name,
              preview_domain: `${name}.vercel.app`,
              project_url: `https://vercel.com/dashboard/${name}`,
              github_repo: `${githubOrg}/${repoName}`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create Vercel project: ${(err as Error).message}`,
          };
        }
      },
    },
    {
      name: 'vercel_get_preview_url',
      description: 'Get the latest preview deployment URL for a Vercel project.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Optional Vercel project id. Preferred when available.',
          required: false,
        },
        project_name: {
          type: 'string',
          description: 'Vercel project name.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Optional Git branch name to filter deployments.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const projectName = String(params.project_name ?? '').trim();
        if (!projectName) return { success: false, error: 'project_name is required.' };
        let projectId = String(params.project_id ?? '').trim();
        const branch = String(params.branch ?? '').trim();

        try {
          if (!projectId) {
            const projectLookup = await vercelRequest(
              `/v9/projects/${encodeURIComponent(projectName)}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            if (!projectLookup.ok) {
              return {
                success: false,
                error: `Vercel API error (${projectLookup.status}): could not resolve project id for ${projectName}.`,
              };
            }
            const projectData = projectLookup.data as Record<string, unknown>;
            projectId = String(projectData.id ?? '').trim();
          }

          if (!projectId) {
            return { success: false, error: `Could not resolve Vercel project id for ${projectName}.` };
          }

          const path = `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=5${branch ? `&meta-gitBranch=${encodeURIComponent(branch)}` : ''}`;
          const { ok, status, data } = await vercelRequest(path, 'GET', undefined, ctx.abortSignal);
          if (!ok) {
            return { success: false, error: `Vercel API error (${status}): could not fetch deployments.` };
          }

          const result = data as Record<string, unknown>;
          const deployments = (result.deployments as unknown[]) ?? [];
          if (deployments.length === 0) {
            return {
              success: true,
              data: {
                state: 'PENDING',
                preview_url: null,
              },
            };
          }

          const latest = deployments[0] as Record<string, unknown>;
          const deploymentUrl = String(latest.url ?? '');
          const deploymentState = String(latest.state ?? 'UNKNOWN');
          if (deploymentState === 'ERROR' || deploymentState === 'CANCELED') {
            return { success: false, error: `Latest deployment is ${deploymentState}.` };
          }
          if (deploymentState !== 'READY') {
            return {
              success: true,
              data: {
                state: deploymentState,
                deployment_url: deploymentUrl ? `https://${deploymentUrl}` : null,
              },
            };
          }

          return {
            success: true,
            data: {
              state: 'READY',
              preview_url: `https://${deploymentUrl}`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get preview URL: ${(err as Error).message}`,
          };
        }
      },
    },
    {
      name: 'vercel_get_production_url',
      description: 'Get the latest production deployment URL for a Vercel project.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Optional Vercel project id. Preferred when available.',
          required: false,
        },
        project_name: {
          type: 'string',
          description: 'Vercel project name.',
          required: true,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const projectName = String(params.project_name ?? '').trim();
        if (!projectName) return { success: false, error: 'project_name is required.' };
        let projectId = String(params.project_id ?? '').trim();

        try {
          if (!projectId) {
            const projectLookup = await vercelRequest(
              `/v9/projects/${encodeURIComponent(projectName)}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            if (!projectLookup.ok) {
              return {
                success: false,
                error: `Vercel API error (${projectLookup.status}): could not resolve project id for ${projectName}.`,
              };
            }
            const projectData = projectLookup.data as Record<string, unknown>;
            projectId = String(projectData.id ?? '').trim();
          }

          if (!projectId) {
            return { success: false, error: `Could not resolve Vercel project id for ${projectName}.` };
          }

          const path = `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&limit=5`;
          const { ok, status, data } = await vercelRequest(path, 'GET', undefined, ctx.abortSignal);
          if (!ok) {
            return { success: false, error: `Vercel API error (${status}): could not fetch production deployments.` };
          }

          const result = data as Record<string, unknown>;
          const deployments = (result.deployments as unknown[]) ?? [];
          if (deployments.length === 0) {
            return {
              success: true,
              data: {
                state: 'PENDING',
                production_url: null,
              },
            };
          }

          const latest = deployments[0] as Record<string, unknown>;
          const deploymentUrl = String(latest.url ?? '');
          const deploymentState = String(latest.state ?? 'UNKNOWN');
          if (deploymentState === 'ERROR' || deploymentState === 'CANCELED') {
            return { success: false, error: `Latest production deployment is ${deploymentState}.` };
          }
          if (deploymentState !== 'READY') {
            return {
              success: true,
              data: {
                state: deploymentState,
                production_url: deploymentUrl ? `https://${deploymentUrl}` : null,
              },
            };
          }

          return {
            success: true,
            data: {
              state: 'READY',
              production_url: `https://${deploymentUrl}`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get production URL: ${(err as Error).message}`,
          };
        }
      },
    },
    {
      name: 'vercel_get_deployment_logs',
      description: 'Get recent build/runtime log events for a Vercel deployment.',
      parameters: {
        deployment_id: {
          type: 'string',
          description: 'Vercel deployment id. If omitted, resolves from latest project deployment.',
          required: false,
        },
        project_id: {
          type: 'string',
          description: 'Optional Vercel project id used when deployment_id is omitted.',
          required: false,
        },
        project_name: {
          type: 'string',
          description: 'Vercel project name used to resolve project id when deployment_id is omitted.',
          required: false,
        },
        target: {
          type: 'string',
          description: 'Deployment target when resolving latest deployment (default: production).',
          required: false,
          enum: ['production', 'preview'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log events to return (default: 100, max: 200).',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        let deploymentId = String(params.deployment_id ?? '').trim();
        const projectName = String(params.project_name ?? '').trim();
        let projectId = String(params.project_id ?? '').trim();
        const target = String(params.target ?? 'production').trim().toLowerCase() === 'preview'
          ? 'preview'
          : 'production';
        const rawLimit = Number(params.limit ?? 100);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 100;

        try {
          if (!deploymentId) {
            if (!projectId) {
              if (!projectName) {
                return {
                  success: false,
                  error: 'Provide deployment_id, or provide project_name/project_id to resolve the latest deployment.',
                };
              }

              const projectLookup = await vercelRequest(
                `/v9/projects/${encodeURIComponent(projectName)}`,
                'GET',
                undefined,
                ctx.abortSignal,
              );

              if (!projectLookup.ok) {
                return {
                  success: false,
                  error: `Vercel API error (${projectLookup.status}): could not resolve project id for ${projectName}.`,
                };
              }

              const projectData = projectLookup.data as Record<string, unknown>;
              projectId = String(projectData.id ?? '').trim();
            }

            if (!projectId) {
              return { success: false, error: 'Could not resolve Vercel project id.' };
            }

            const path = `/v6/deployments?projectId=${encodeURIComponent(projectId)}${target === 'production' ? '&target=production' : ''}&limit=1`;
            const latestDeployment = await vercelRequest(path, 'GET', undefined, ctx.abortSignal);
            if (!latestDeployment.ok) {
              return {
                success: false,
                error: `Vercel API error (${latestDeployment.status}): could not resolve latest ${target} deployment.`,
              };
            }

            const latestResult = latestDeployment.data as Record<string, unknown>;
            const deployments = (latestResult.deployments as unknown[]) ?? [];
            if (deployments.length === 0) {
              return {
                success: false,
                error: `No ${target} deployments found for project ${projectId}.`,
              };
            }

            deploymentId = String((deployments[0] as Record<string, unknown>).uid ?? '').trim();
          }

          if (!deploymentId) {
            return { success: false, error: 'Could not resolve deployment id.' };
          }

          const deploymentInfo = await vercelRequest(
            `/v13/deployments/${encodeURIComponent(deploymentId)}`,
            'GET',
            undefined,
            ctx.abortSignal,
          );

          let deploymentState: string | null = null;
          let deploymentUrl: string | null = null;
          let inspectorUrl: string | null = null;
          if (deploymentInfo.ok && deploymentInfo.data) {
            const d = deploymentInfo.data as Record<string, unknown>;
            deploymentState = String(d.state ?? '') || null;
            deploymentUrl = String(d.url ?? '') || null;
            inspectorUrl = String(d.inspectorUrl ?? '') || null;
          }

          const eventEndpoints = [
            `/v3/deployments/${encodeURIComponent(deploymentId)}/events?limit=${limit}`,
            `/v2/deployments/${encodeURIComponent(deploymentId)}/events?limit=${limit}`,
            `/v6/deployments/${encodeURIComponent(deploymentId)}/events?limit=${limit}`,
          ];

          let parsedLogs: Array<Record<string, unknown>> = [];
          let selectedEndpoint: string | null = null;

          for (const endpoint of eventEndpoints) {
            const response = await vercelRequest(endpoint, 'GET', undefined, ctx.abortSignal);
            if (!response.ok || !response.data) continue;

            const payload = response.data as Record<string, unknown>;
            const candidates = Array.isArray(payload.events)
              ? payload.events
              : Array.isArray(payload.logs)
                ? payload.logs
                : Array.isArray(response.data)
                  ? response.data as unknown[]
                  : [];

            const normalized = candidates.map((event) => {
              const item = event as Record<string, unknown>;
              const payloadObj = (item.payload as Record<string, unknown> | undefined) ?? {};
              const text = item.text
                ?? item.message
                ?? payloadObj.text
                ?? payloadObj.message
                ?? payloadObj.error
                ?? item.type
                ?? JSON.stringify(item);

              return {
                created_at: item.created ?? item.createdAt ?? item.time ?? null,
                level: item.level ?? payloadObj.level ?? null,
                type: item.type ?? item.event ?? null,
                message: String(text),
              };
            });

            if (normalized.length > 0) {
              parsedLogs = normalized;
              selectedEndpoint = endpoint;
              break;
            }
          }

          if (parsedLogs.length === 0) {
            return {
              success: false,
              error: 'Could not retrieve deployment logs from Vercel API for this deployment. Check token/team scope and deployment availability.',
            };
          }

          return {
            success: true,
            data: {
              deployment_id: deploymentId,
              state: deploymentState,
              deployment_url: deploymentUrl ? `https://${deploymentUrl}` : null,
              inspector_url: inspectorUrl,
              log_source: selectedEndpoint,
              total_events: parsedLogs.length,
              logs: parsedLogs,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get deployment logs: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}