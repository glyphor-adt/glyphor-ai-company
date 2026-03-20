import type { ToolContext, ToolResult } from './types.js';
import { applyV4APatch, parseV4APatch, type V4APatchDocument } from './v4aDiff.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_OWNER = 'glyphor-adt';
const BLOCKED_PATHS = new Set([
  'packages/agent-runtime/src/companyAgentRunner.ts',
  'packages/scheduler/src/authorityGates.ts',
]);
const BLOCKED_PREFIXES = ['infra/', '.github/workflows/', 'docker/'];

interface GitHubFile {
  sha?: string;
  content: string;
}

export interface ApplyPatchCallParams {
  repo: string;
  branch: string;
  commit_message: string;
  patch: V4APatchDocument | string;
}

function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured.');
  return token;
}

function ensureAllowedBranch(branch: string): void {
  if (!branch.startsWith('feature/agent-')) {
    throw new Error('Branch name must start with "feature/agent-".');
  }
}

function ensureAllowedPath(path: string): void {
  if (BLOCKED_PATHS.has(path)) {
    throw new Error(`Path "${path}" is protected and requires human review.`);
  }
  for (const prefix of BLOCKED_PREFIXES) {
    if (path.startsWith(prefix)) {
      throw new Error(`Path "${path}" is in protected directory "${prefix}".`);
    }
  }
}

async function githubRequest<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const token = getGitHubToken();
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    signal,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`GitHub API ${response.status}: ${text}`);
  }

  return await response.json() as T;
}

async function getGitHubFile(repo: string, branch: string, path: string, signal?: AbortSignal): Promise<GitHubFile> {
  const token = getGitHubToken();
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (response.status === 404) {
    return { content: '' };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`GitHub API ${response.status}: ${text}`);
  }

  const json = await response.json() as { sha: string; content: string };
  return {
    sha: json.sha,
    content: Buffer.from(json.content, 'base64').toString('utf-8'),
  };
}

export async function applyPatchToGitHub(
  params: ApplyPatchCallParams,
  context?: Pick<ToolContext, 'abortSignal'>,
): Promise<ToolResult> {
  try {
    ensureAllowedBranch(params.branch);
    const patch = parseV4APatch(params.patch);
    const filesWritten: string[] = [];
    const commitShas: string[] = [];

    for (const filePatch of patch.files) {
      ensureAllowedPath(filePatch.path);
      const current = await getGitHubFile(params.repo, params.branch, filePatch.path, context?.abortSignal);
      const nextContent = applyV4APatch(current.content, filePatch);
      const body = {
        message: params.commit_message,
        content: Buffer.from(nextContent).toString('base64'),
        branch: params.branch,
        ...(current.sha ? { sha: current.sha } : {}),
      };
      const update = await githubRequest<{ commit: { sha: string } }>(
        `/repos/${GITHUB_OWNER}/${params.repo}/contents/${filePatch.path}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        context?.abortSignal,
      );
      filesWritten.push(filePatch.path);
      commitShas.push(update.commit.sha);
    }

    // Auto-create a pull request so the fix can be reviewed and deployed
    let prUrl: string | undefined;
    try {
      const prBody = {
        title: params.commit_message,
        head: params.branch,
        base: 'main',
        body: `Automated fix by Nexus (platform-intel).\n\nFiles changed:\n${filesWritten.map(f => '- ' + f).join('\n')}`,
      };
      const pr = await githubRequest<{ html_url: string; number: number }>(
        `/repos/${GITHUB_OWNER}/${params.repo}/pulls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prBody),
        },
        context?.abortSignal,
      );
      prUrl = pr.html_url;
    } catch (prErr) {
      // PR creation is best-effort — the branch + commits are the important part
      console.warn('[PatchHarness] PR creation failed (branch still has commits):', (prErr as Error).message);
    }

    return {
      success: true,
      data: {
        repo: params.repo,
        branch: params.branch,
        files: filesWritten,
        commit_shas: commitShas,
        pull_request_url: prUrl ?? null,
      },
      filesWritten: filesWritten.length,
      memoryKeysWritten: 0,
    };
  } catch (err) {
    return {
      success: false,
      error: `apply_patch_call failed: ${(err as Error).message}`,
      filesWritten: 0,
      memoryKeysWritten: 0,
    };
  }
}
