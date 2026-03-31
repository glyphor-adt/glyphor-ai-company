/**
 * github_push_files
 *
 * Takes the file map from build_website_foundation and commits all files
 * to a GitHub branch in one batched operation.
 *
 * Uses the GitHub API's Git Trees endpoint for efficient multi-file commits
 * (one API call instead of one per file).
 *
 * Add to: packages/integrations/src/github/githubPushFiles.ts
 * Register in: packages/agents/src/shared/scaffoldTools.ts
 *
 * Note: The GitHub MCP server's push_files tool also does this.
 * Use whichever is already wired in your runtime — this is the
 * standalone version if you need direct control.
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

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
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

export function createGithubPushFilesTools(): ToolDefinition[] {
  return [
    {
      name: 'github_push_files',
      description:
        'Commits all files from build_website_foundation to a GitHub branch in one operation. ' +
        'Call this immediately after build_website_foundation returns. ' +
        'Creates the branch if it does not exist. ' +
        'Returns the commit SHA and branch URL.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format. e.g. "Glyphor-Fuse/acme-corp-landing"',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch to commit to. e.g. "feature/initial-build"',
          required: true,
        },
        files: {
          type: 'object',
          description:
            'File map from build_website_foundation: { "filePath": "fileContent", ... }',
          required: true,
        },
        commit_message: {
          type: 'string',
          description:
            'Commit message. Defaults to "feat: initial website build from Glyphor pipeline"',
          required: false,
        },
      },
      async execute(
        params: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<ToolResult> {
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

        const [owner, repoName] = repo.split('/');
        if (!owner || !repoName) {
          return { success: false, error: 'repo must be in "owner/name" format.' };
        }

        console.log(
          `[GitHubPush] Pushing ${Object.keys(files).length} files to ${repo}@${branch}`,
        );

        try {
          // Step 1: Get default branch HEAD sha
          const repoRes = await githubRequest(`/repos/${repo}`, 'GET', undefined, ctx.abortSignal);
          if (!repoRes.ok) {
            return {
              success: false,
              error: `Failed to fetch repo info (${repoRes.status}). Check repo name and token.`,
            };
          }
          const repoData = repoRes.data as Record<string, unknown>;
          const defaultBranch = String(repoData.default_branch ?? 'main');

          // Step 2: Get base commit SHA (from default branch or target branch)
          let baseSha: string;
          let baseTreeSha: string;

          // Try to get target branch first (for repair rounds)
          const branchRes = await githubRequest(
            `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
            'GET',
            undefined,
            ctx.abortSignal,
          );

          if (branchRes.ok) {
            // Branch exists — push on top of it
            const branchData = branchRes.data as Record<string, unknown>;
            const obj = branchData.object as Record<string, unknown>;
            baseSha = String(obj.sha);

            const commitRes = await githubRequest(
              `/repos/${repo}/git/commits/${baseSha}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            const commitData = commitRes.data as Record<string, unknown>;
            const tree = commitData.tree as Record<string, unknown>;
            baseTreeSha = String(tree.sha);
          } else {
            // Branch doesn't exist — create from default branch
            const defaultRef = await githubRequest(
              `/repos/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            if (!defaultRef.ok) {
              return {
                success: false,
                error: `Could not find base branch "${defaultBranch}" in ${repo}.`,
              };
            }
            const defaultRefData = defaultRef.data as Record<string, unknown>;
            const obj = defaultRefData.object as Record<string, unknown>;
            baseSha = String(obj.sha);

            const commitRes = await githubRequest(
              `/repos/${repo}/git/commits/${baseSha}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );
            const commitData = commitRes.data as Record<string, unknown>;
            const tree = commitData.tree as Record<string, unknown>;
            baseTreeSha = String(tree.sha);
          }

          // Step 3: Create blobs for all files
          console.log(`[GitHubPush] Creating ${Object.keys(files).length} blobs...`);
          const treeItems: Array<{
            path: string;
            mode: string;
            type: string;
            sha: string;
          }> = [];

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
            treeItems.push({
              path: filePath,
              mode: '100644',
              type: 'blob',
              sha: String(blobData.sha),
            });
          }

          // Step 4: Create tree
          const treeRes = await githubRequest(
            `/repos/${repo}/git/trees`,
            'POST',
            { base_tree: baseTreeSha, tree: treeItems },
            ctx.abortSignal,
          );
          if (!treeRes.ok) {
            return { success: false, error: `Failed to create git tree (${treeRes.status}).` };
          }
          const treeData = treeRes.data as Record<string, unknown>;
          const newTreeSha = String(treeData.sha);

          // Step 5: Create commit
          const commitRes = await githubRequest(
            `/repos/${repo}/git/commits`,
            'POST',
            {
              message: commitMessage,
              tree: newTreeSha,
              parents: [baseSha],
            },
            ctx.abortSignal,
          );
          if (!commitRes.ok) {
            return { success: false, error: `Failed to create commit (${commitRes.status}).` };
          }
          const newCommitData = commitRes.data as Record<string, unknown>;
          const newCommitSha = String(newCommitData.sha);

          // Step 6: Update or create branch ref
          if (branchRes.ok) {
            // Update existing branch
            await githubRequest(
              `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
              'PATCH',
              { sha: newCommitSha, force: false },
              ctx.abortSignal,
            );
          } else {
            // Create new branch
            await githubRequest(
              `/repos/${repo}/git/refs`,
              'POST',
              { ref: `refs/heads/${branch}`, sha: newCommitSha },
              ctx.abortSignal,
            );
          }

          const branchUrl = `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`;

          console.log(
            `[GitHubPush] ✅ Pushed ${Object.keys(files).length} files. ` +
            `Commit: ${newCommitSha.slice(0, 7)} → ${branchUrl}`,
          );

          return {
            success: true,
            data: {
              commit_sha: newCommitSha,
              branch,
              branch_url: branchUrl,
              files_pushed: Object.keys(files).length,
              message:
                `${Object.keys(files).length} files committed to ${repo}@${branch}. ` +
                `Vercel will auto-deploy from this push. ` +
                `Next: call vercel_get_preview_url to wait for the deployment to be ready.`,
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
