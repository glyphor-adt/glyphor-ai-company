/**
 * Vercel Project Provisioning Tools
 *
 * Creates a new Vercel project and links it to a GitHub repo.
 * Called by chief-of-staff or devops-engineer at the start of every
 * client site build.
 *
 * Add to packages/integrations/src/vercel/index.ts exports
 * and register in packages/agents/src/shared/scaffoldTools.ts
 *
 * Required env: VERCEL_API_TOKEN, VERCEL_TEAM_ID (optional)
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

const VERCEL_API = 'https://api.vercel.com';
const GITHUB_ORG = process.env.GITHUB_CLIENT_REPOS_ORG || 'Glyphor-Fuse';

function getVercelToken(): string {
  const token = (process.env.VERCEL_API_TOKEN || '').trim();
  if (!token) throw new Error('VERCEL_API_TOKEN is not configured.');
  return token;
}

function getTeamId(): string | undefined {
  return process.env.VERCEL_TEAM_ID?.trim() || undefined;
}

function readVercelErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const root = data as Record<string, unknown>;
  const nested = root.error;
  if (nested && typeof nested === 'object') {
    const msg = (nested as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.trim().length > 0) return msg.trim();
  }
  const direct = root.message;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  return '';
}

function shouldRetryWithoutTeamScope(status: number, method: string, data: unknown): boolean {
  const message = readVercelErrorMessage(data);
  if (status === 400 && /install\s+the\s+github\s+integration\s+first/i.test(message)) {
    return true;
  }

  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod === 'GET' && (status === 403 || status === 404)) {
    return true;
  }

  return false;
}

async function vercelRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = getVercelToken();
  const teamId = getTeamId();

  const send = async (includeTeamId: boolean): Promise<{ ok: boolean; status: number; data: unknown }> => {
    const url = new URL(`${VERCEL_API}${path}`);
    if (includeTeamId && teamId) {
      url.searchParams.set('teamId', teamId);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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
  };

  const primary = await send(true);
  if (primary.ok || !teamId || !shouldRetryWithoutTeamScope(primary.status, method, primary.data)) {
    return primary;
  }

  const fallback = await send(false);
  return fallback.ok ? fallback : primary;
}

export function createVercelProjectTools(): ToolDefinition[] {
  return [
    {
      name: 'vercel_create_project',
      description:
        'Creates a new Vercel project linked to a GitHub repository and configures it ' +
        'for preview deployments. Call this immediately after github_create_from_template. ' +
        'Returns the project ID, project URL, and preview domain.',
      parameters: {
        repo_name: {
          type: 'string',
          description:
            'GitHub repository name (same value used in github_create_from_template). ' +
            'e.g. "acme-corp-landing"',
          required: true,
        },
        project_name: {
          type: 'string',
          description:
            'Display name for the Vercel project. Can include spaces. ' +
            'e.g. "Acme Corp Landing". Defaults to repo_name if not provided.',
          required: false,
        },
        framework: {
          type: 'string',
          description:
            'Framework preset. Always "vite" for Glyphor template projects.',
          required: false,
        },
        github_org: {
          type: 'string',
          description:
            `GitHub org owning the repo. Defaults to "${GITHUB_ORG}".`,
          required: false,
        },
      },
      async execute(
        params: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<ToolResult> {
        const repoName = String(params.repo_name ?? '').trim();
        if (!repoName) {
          return { success: false, error: 'repo_name is required.' };
        }

        const projectName = String(params.project_name ?? repoName).trim();
        const framework = String(params.framework ?? 'vite').trim();
        const githubOrg = String(params.github_org ?? GITHUB_ORG).trim();

        console.log(
          `[VercelProject] Creating project "${projectName}" ` +
          `linked to ${githubOrg}/${repoName}`,
        );

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
              // Enable preview deployments on every push
              buildCommand: 'npm run build',
              outputDirectory: 'dist',
              installCommand: 'npm install',
              // Auto-deploy on push to any branch
              autoAssignCustomDomains: false,
            },
            ctx.abortSignal,
          );

          if (!ok) {
            const err = data as Record<string, unknown>;
            const message = String(err?.error?.message ?? 'Unknown Vercel error');
            if (status === 400 && /install\s+the\s+github\s+integration\s+first/i.test(message)) {
              return {
                success: false,
                error:
                  `Vercel API error (400): ${message} `
                  + `Verify Vercel Team Settings > Integrations > GitHub for ${githubOrg}, `
                  + 'then ensure the Vercel app has repository access before retrying.',
              };
            }
            return {
              success: false,
              error: `Vercel API error (${status}): ${message}`,
            };
          }

          const project = data as Record<string, unknown>;
          const projectId = String(project.id ?? '');
          const name = String(project.name ?? projectName);
          const previewDomain = `${name}.vercel.app`;

          console.log(
            `[VercelProject] ✅ Created project: ${projectId} → https://${previewDomain}`,
          );

          return {
            success: true,
            data: {
              project_id: projectId,
              project_name: name,
              preview_domain: previewDomain,
              project_url: `https://vercel.com/dashboard/${name}`,
              github_repo: `${githubOrg}/${repoName}`,
              message:
                `Vercel project created. Preview deployments will be available at ` +
                `https://${previewDomain} after the first push to GitHub. ` +
                `Project ID: ${projectId}. ` +
                `Next: create a feature branch and invoke codex to build the site.`,
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
      description:
        'Gets the latest preview deployment URL for a Vercel project on a specific branch. ' +
        'Call after pushing code to GitHub to get the live preview URL for design review.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Vercel project name.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Git branch name to get the preview for. e.g. "feature/initial-build"',
          required: false,
        },
      },
      async execute(
        params: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<ToolResult> {
        const projectName = String(params.project_name ?? '').trim();
        if (!projectName) {
          return { success: false, error: 'project_name is required.' };
        }
        const branch = String(params.branch ?? '').trim();

        try {
          // Poll for latest deployment
          const path = `/v6/deployments?projectId=${encodeURIComponent(projectName)}&limit=5${branch ? `&meta-gitBranch=${encodeURIComponent(branch)}` : ''}`;
          const { ok, status, data } = await vercelRequest(path, 'GET', undefined, ctx.abortSignal);

          if (!ok) {
            return {
              success: false,
              error: `Vercel API error (${status}): could not fetch deployments`,
            };
          }

          const result = data as Record<string, unknown>;
          const deployments = (result.deployments as unknown[]) ?? [];

          if (deployments.length === 0) {
            return {
              success: false,
              error: 'No deployments found. Push code to GitHub to trigger a preview deployment.',
            };
          }

          const latest = deployments[0] as Record<string, unknown>;
          const deploymentUrl = String(latest.url ?? '');
          const deploymentState = String(latest.state ?? 'UNKNOWN');

          if (deploymentState === 'ERROR' || deploymentState === 'CANCELED') {
            return {
              success: false,
              error: `Latest deployment is in ${deploymentState} state. Check Vercel dashboard for build logs.`,
            };
          }

          if (deploymentState !== 'READY') {
            return {
              success: true,
              data: {
                state: deploymentState,
                message: `Deployment is ${deploymentState}. Check again in a moment.`,
                deployment_url: deploymentUrl ? `https://${deploymentUrl}` : null,
              },
            };
          }

          return {
            success: true,
            data: {
              state: 'READY',
              preview_url: `https://${deploymentUrl}`,
              message: `Preview is live at https://${deploymentUrl}`,
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
  ];
}
