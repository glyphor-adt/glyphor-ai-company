import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { requireWebsitePipelineEnv } from '../websitePipelineEnv.js';

function getGitHubToken(): string {
  return requireWebsitePipelineEnv('github-token');
}

async function githubRequest(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getGitHubToken()}`,
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

export function createGithubPushFilesTools(): ToolDefinition[] {
  return [
    {
      name: 'github_push_files',
      description: 'Commit a file map to a GitHub branch in one batched operation.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Target branch for the commit.',
          required: true,
        },
        files: {
          type: 'object',
          description: 'File map where keys are file paths and values are full contents.',
          required: true,
        },
        commit_message: {
          type: 'string',
          description: 'Optional commit message.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repo = String(params.repo ?? '').trim();
        const branch = String(params.branch ?? '').trim();
        const files = params.files as Record<string, string> | null;
        const commitMessage = String(
          params.commit_message ?? 'feat: initial website build from Glyphor pipeline',
        ).trim();

        if (!repo) return { success: false, error: 'repo is required.' };
        if (!branch) return { success: false, error: 'branch is required.' };
        if (!files || Object.keys(files).length === 0) {
          return { success: false, error: 'files is required and must not be empty.' };
        }

        try {
          const repoRes = await githubRequest(`/repos/${repo}`, 'GET', undefined, ctx.abortSignal);
          if (!repoRes.ok) {
            return {
              success: false,
              error: `Failed to fetch repo info (${repoRes.status}).`,
            };
          }

          const repoData = repoRes.data as Record<string, unknown>;
          const defaultBranch = String(repoData.default_branch ?? 'main');

          let baseSha: string;
          let baseTreeSha: string;
          const branchRes = await githubRequest(
            `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
            'GET',
            undefined,
            ctx.abortSignal,
          );

          if (branchRes.ok) {
            const branchData = branchRes.data as Record<string, unknown>;
            const obj = branchData.object as Record<string, unknown>;
            baseSha = String(obj.sha);
          } else {
            const defaultRef = await githubRequest(
              `/repos/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            if (!defaultRef.ok) {
              return { success: false, error: `Could not find base branch ${defaultBranch}.` };
            }
            const defaultRefData = defaultRef.data as Record<string, unknown>;
            const obj = defaultRefData.object as Record<string, unknown>;
            baseSha = String(obj.sha);
          }

          const commitRes = await githubRequest(
            `/repos/${repo}/git/commits/${baseSha}`,
            'GET',
            undefined,
            ctx.abortSignal,
          );
          if (!commitRes.ok) {
            return { success: false, error: `Failed to read base commit (${commitRes.status}).` };
          }
          const commitData = commitRes.data as Record<string, unknown>;
          const tree = commitData.tree as Record<string, unknown>;
          baseTreeSha = String(tree.sha);

          const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
          for (const [filePath, content] of Object.entries(files)) {
            const blobRes = await githubRequest(
              `/repos/${repo}/git/blobs`,
              'POST',
              { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
              ctx.abortSignal,
            );
            if (!blobRes.ok) {
              const errData = blobRes.data as Record<string, unknown>;
              return {
                success: false,
                error: `Failed to create blob for ${filePath}: ${String(errData?.message ?? 'unknown error')}`,
              };
            }
            const blobData = blobRes.data as Record<string, unknown>;
            treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: String(blobData.sha) });
          }

          const treeRes = await githubRequest(
            `/repos/${repo}/git/trees`,
            'POST',
            { base_tree: baseTreeSha, tree: treeItems },
            ctx.abortSignal,
          );
          if (!treeRes.ok) return { success: false, error: `Failed to create git tree (${treeRes.status}).` };
          const treeData = treeRes.data as Record<string, unknown>;

          const newCommitRes = await githubRequest(
            `/repos/${repo}/git/commits`,
            'POST',
            { message: commitMessage, tree: String(treeData.sha), parents: [baseSha] },
            ctx.abortSignal,
          );
          if (!newCommitRes.ok) return { success: false, error: `Failed to create commit (${newCommitRes.status}).` };
          const newCommitData = newCommitRes.data as Record<string, unknown>;
          const newCommitSha = String(newCommitData.sha);

          if (branchRes.ok) {
            await githubRequest(
              `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
              'PATCH',
              { sha: newCommitSha, force: false },
              ctx.abortSignal,
            );
          } else {
            await githubRequest(
              `/repos/${repo}/git/refs`,
              'POST',
              { ref: `refs/heads/${branch}`, sha: newCommitSha },
              ctx.abortSignal,
            );
          }

          return {
            success: true,
            data: {
              commit_sha: newCommitSha,
              branch,
              branch_url: `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`,
              files_pushed: Object.keys(files).length,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to push files: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}