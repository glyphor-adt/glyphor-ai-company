import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getWebsitePipelineOrg, requireWebsitePipelineEnv } from '../websitePipelineEnv.js';
import { getWebsitePipelineGitHubToken } from './websitePipelineAuth.js';

const TEMPLATE_OWNER = 'Glyphor-Fuse';
const TEMPLATE_REPO = 'glyphor-fuse-template';
const DEFAULT_ORG = getWebsitePipelineOrg();

async function githubRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await getWebsitePipelineGitHubToken();
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
        'Create a new client GitHub repository from the Glyphor Fuse website template.',
      parameters: {
        repo_name: {
          type: 'string',
          description: 'Lowercase hyphenated repository slug.',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Optional repository description.',
          required: false,
        },
        owner: {
          type: 'string',
          description: `Optional GitHub org or user. Defaults to ${DEFAULT_ORG}.`,
          required: false,
        },
        private: {
          type: 'boolean',
          description: 'Whether the repository should be private. Defaults to true.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoName = String(params.repo_name ?? '').trim();
        if (!repoName) return { success: false, error: 'repo_name is required.' };
        if (!/^[a-z0-9-]+$/.test(repoName)) {
          return {
            success: false,
            error: 'repo_name must use lowercase letters, numbers, and hyphens only.',
          };
        }

        const owner = String(params.owner ?? DEFAULT_ORG).trim();
        const description = String(params.description ?? '').trim();
        const isPrivate = params.private !== false;

        try {
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
            if (status === 422 && message.includes('already exists')) {
              return {
                success: false,
                error: `Repository ${owner}/${repoName} already exists.`,
              };
            }
            return { success: false, error: `GitHub API error (${status}): ${message}` };
          }

          const repo = data as Record<string, unknown>;
          return {
            success: true,
            data: {
              full_name: String(repo.full_name ?? `${owner}/${repoName}`),
              repo_url: String(repo.html_url ?? ''),
              clone_url: String(repo.clone_url ?? ''),
              ssh_url: String(repo.ssh_url ?? ''),
              default_branch: String(repo.default_branch ?? 'main'),
              owner,
              repo: repoName,
              template: `${TEMPLATE_OWNER}/${TEMPLATE_REPO}`,
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