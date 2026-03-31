import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getWebsitePipelineGitHubToken } from './websitePipelineAuth.js';

function parseRepoFullName(repo: string): { owner: string; name: string; fullName: string } {
  const trimmed = repo.trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    throw new Error('repo must use owner/name format.');
  }

  return {
    owner: match[1],
    name: match[2],
    fullName: `${match[1]}/${match[2]}`,
  };
}

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

export function createGithubPullRequestTools(): ToolDefinition[] {
  return [
    {
      name: 'github_create_pull_request',
      description: 'Open a pull request for an arbitrary GitHub repository in owner/name format. Use this to promote website pipeline changes from a working branch to main.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        head_branch: {
          type: 'string',
          description: 'Source branch for the pull request.',
          required: true,
        },
        base_branch: {
          type: 'string',
          description: 'Target branch. Defaults to main.',
          required: false,
        },
        title: {
          type: 'string',
          description: 'Pull request title.',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Pull request body in markdown.',
          required: false,
        },
        draft: {
          type: 'boolean',
          description: 'Whether to open the pull request as a draft. Defaults to false.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoInput = String(params.repo ?? '').trim();
        const headBranch = String(params.head_branch ?? '').trim();
        const baseBranch = String(params.base_branch ?? 'main').trim() || 'main';
        const title = String(params.title ?? '').trim();
        const body = String(params.body ?? '').trim();
        const draft = params.draft === true;

        if (!repoInput) return { success: false, error: 'repo is required.' };
        if (!headBranch) return { success: false, error: 'head_branch is required.' };
        if (!title) return { success: false, error: 'title is required.' };

        try {
          const { owner, name, fullName } = parseRepoFullName(repoInput);
          const { ok, status, data } = await githubRequest(
            `/repos/${owner}/${name}/pulls`,
            'POST',
            {
              title,
              head: `${owner}:${headBranch}`,
              base: baseBranch,
              body: body || undefined,
              draft,
            },
            ctx.abortSignal,
          );

          if (!ok) {
            const err = data as Record<string, unknown> | null;
            const message = String(err?.message ?? 'Unknown GitHub API error');
            return { success: false, error: `GitHub API error (${status}): ${message}` };
          }

          const pr = data as Record<string, unknown>;
          return {
            success: true,
            data: {
              repo: fullName,
              pr_number: Number(pr.number ?? 0),
              pr_url: String(pr.html_url ?? ''),
              head_branch: headBranch,
              base_branch: baseBranch,
              draft: Boolean(pr.draft),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create pull request: ${(err as Error).message}`,
          };
        }
      },
    },
    {
      name: 'github_merge_pull_request',
      description: 'Merge a pull request for an arbitrary GitHub repository in owner/name format. Use this after CI and review pass to promote a website pipeline build to main.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        pr_number: {
          type: 'number',
          description: 'Pull request number to merge.',
          required: true,
        },
        merge_method: {
          type: 'string',
          description: 'Merge method. Defaults to squash.',
          required: false,
          enum: ['merge', 'squash', 'rebase'],
        },
        commit_title: {
          type: 'string',
          description: 'Optional merge commit title.',
          required: false,
        },
        commit_message: {
          type: 'string',
          description: 'Optional merge commit message.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoInput = String(params.repo ?? '').trim();
        const prNumber = Number(params.pr_number ?? NaN);
        const mergeMethod = String(params.merge_method ?? 'squash').trim() || 'squash';
        const commitTitle = String(params.commit_title ?? '').trim();
        const commitMessage = String(params.commit_message ?? '').trim();

        if (!repoInput) return { success: false, error: 'repo is required.' };
        if (!Number.isFinite(prNumber) || prNumber <= 0) {
          return { success: false, error: 'pr_number must be a positive number.' };
        }

        try {
          const { owner, name, fullName } = parseRepoFullName(repoInput);
          const { ok, status, data } = await githubRequest(
            `/repos/${owner}/${name}/pulls/${prNumber}/merge`,
            'PUT',
            {
              merge_method: mergeMethod,
              commit_title: commitTitle || undefined,
              commit_message: commitMessage || undefined,
            },
            ctx.abortSignal,
          );

          if (!ok) {
            const err = data as Record<string, unknown> | null;
            const message = String(err?.message ?? 'Unknown GitHub API error');
            return { success: false, error: `GitHub API error (${status}): ${message}` };
          }

          const merge = data as Record<string, unknown>;
          return {
            success: true,
            data: {
              repo: fullName,
              pr_number: prNumber,
              merged: Boolean(merge.merged),
              sha: String(merge.sha ?? ''),
              message: String(merge.message ?? ''),
              merge_method: mergeMethod,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to merge pull request: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}