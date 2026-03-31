/**
 * GitHub Create Repository From Template Tool
 *
 * Creates a new client repository from the Glyphor Fuse template.
 * Uses the GitHub REST API template generation endpoint.
 *
 * Add this to packages/integrations/src/github/index.ts exports
 * and register in packages/agents/src/shared/scaffoldTools.ts
 *
 * Required env: GITHUB_SERVICE_PAT (with repo scope)
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

const TEMPLATE_OWNER = 'Glyphor-Fuse';
const TEMPLATE_REPO = 'glyphor-fuse-template';
const DEFAULT_ORG = process.env.GITHUB_CLIENT_REPOS_ORG || 'Glyphor-Fuse';

function getGitHubToken(): string {
  const token = (
    process.env.GITHUB_SERVICE_PAT ||
    process.env.GITHUB_MCP_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ''
  ).trim();
  if (!token) throw new Error('No GitHub token configured. Set GITHUB_SERVICE_PAT.');
  return token;
}

async function githubRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = getGitHubToken();
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
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

export function createGithubFromTemplateTools(): ToolDefinition[] {
  return [
    {
      name: 'github_create_from_template',
      description:
        'Creates a new client GitHub repository from the Glyphor Fuse website template. ' +
        'Always use this tool when starting a new client website or landing page build. ' +
        'Never create a blank repo for website work — always use this template. ' +
        'Returns the new repo URL, clone URL, and default branch.',
      parameters: {
        repo_name: {
          type: 'string',
          description:
            'Name for the new repository. Use the projectSlug from the normalized brief. ' +
            'Format: lowercase, hyphens only, e.g. "acme-corp-landing" or "nova-cafe-site".',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Short description of the client site being built.',
          required: false,
        },
        owner: {
          type: 'string',
          description:
            `GitHub org or user to own the new repo. Defaults to "${DEFAULT_ORG}".`,
          required: false,
        },
        private: {
          type: 'boolean',
          description: 'Whether the repo should be private. Defaults to true.',
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

        // Validate slug format
        if (!/^[a-z0-9-]+$/.test(repoName)) {
          return {
            success: false,
            error:
              'repo_name must be lowercase letters, numbers, and hyphens only. ' +
              `Received: "${repoName}"`,
          };
        }

        const owner = String(params.owner ?? DEFAULT_ORG).trim();
        const description = String(params.description ?? '').trim();
        const isPrivate = params.private !== false; // default true

        console.log(
          `[GitHubTemplate] Creating repo "${owner}/${repoName}" ` +
          `from template "${TEMPLATE_OWNER}/${TEMPLATE_REPO}"`,
        );

        try {
          // GitHub API: Generate a repo from a template
          // POST /repos/{template_owner}/{template_repo}/generate
          const { ok, status, data } = await githubRequest(
            `/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`,
            'POST',
            {
              owner,
              name: repoName,
              description: description || `Glyphor client site: ${repoName}`,
              private: isPrivate,
              include_all_branches: false,
            },
            ctx.abortSignal,
          );

          if (!ok) {
            const err = data as Record<string, unknown>;
            const message = String(err?.message ?? 'Unknown GitHub API error');

            // Handle common errors with clear guidance
            if (status === 422 && message.includes('already exists')) {
              return {
                success: false,
                error:
                  `Repository "${owner}/${repoName}" already exists. ` +
                  'Use a different repo_name or check if this project was already started.',
              };
            }
            if (status === 404) {
              return {
                success: false,
                error:
                  `Template repository "${TEMPLATE_OWNER}/${TEMPLATE_REPO}" not found. ` +
                  'Verify the template repo exists and the GitHub token has access.',
              };
            }

            return {
              success: false,
              error: `GitHub API error (${status}): ${message}`,
            };
          }

          const repo = data as Record<string, unknown>;
          const htmlUrl = String(repo.html_url ?? '');
          const cloneUrl = String(repo.clone_url ?? '');
          const sshUrl = String(repo.ssh_url ?? '');
          const defaultBranch = String(repo.default_branch ?? 'main');
          const fullName = String(repo.full_name ?? `${owner}/${repoName}`);

          console.log(`[GitHubTemplate] ✅ Created: ${htmlUrl}`);

          return {
            success: true,
            data: {
              full_name: fullName,
              repo_url: htmlUrl,
              clone_url: cloneUrl,
              ssh_url: sshUrl,
              default_branch: defaultBranch,
              owner,
              repo: repoName,
              template: `${TEMPLATE_OWNER}/${TEMPLATE_REPO}`,
              message:
                `Repository created: ${htmlUrl}. ` +
                `Default branch: ${defaultBranch}. ` +
                `Next: link to Vercel and create a feature branch for the build.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create repository: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
