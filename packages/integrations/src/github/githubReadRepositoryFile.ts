/**
 * Read files from arbitrary GitHub repos using website-pipeline credentials
 * (same token selection as github_push_files: core org + Glyphor-Fuse clients).
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getWebsitePipelineGitHubToken } from './websitePipelineAuth.js';

async function githubRequest(
  repo: string,
  apiPath: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await getWebsitePipelineGitHubToken(repo);
  const response = await fetch(`https://api.github.com${apiPath}`, {
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

function encodeRepoContentPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

export function createGithubReadRepositoryFileTools(): ToolDefinition[] {
  return [
    {
      name: 'github_get_repository_file',
      description:
        'Read a single file from a GitHub repository in owner/name format (e.g. Glyphor-Fuse/the-bakery). '
        + 'Use for package.json, vite.config.ts, etc. Same auth as github_push_files — prefer this over web_fetch for private repos.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository as owner/name (not only the short company repo key).',
          required: true,
        },
        path: {
          type: 'string',
          description: 'File path in the repo (e.g. package.json, src/App.tsx).',
          required: true,
        },
        ref: {
          type: 'string',
          description: 'Optional branch name or commit SHA. Defaults to the repo default branch.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repo = String(params.repo ?? '').trim();
        const path = String(params.path ?? '').trim();
        const ref = String(params.ref ?? '').trim();

        if (!repo) return { success: false, error: 'repo is required (owner/name).' };
        if (!path) return { success: false, error: 'path is required.' };

        const pathEnc = encodeRepoContentPath(path);
        const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
        const res = await githubRequest(
          repo,
          `/repos/${repo}/contents/${pathEnc}${query}`,
          'GET',
          undefined,
          ctx.abortSignal,
        );

        if (!res.ok) {
          const err = res.data as Record<string, unknown> | null;
          const msg = err && typeof err.message === 'string' ? err.message : `HTTP ${res.status}`;
          return {
            success: false,
            error: `Could not read ${path} from ${repo}: ${msg}`,
          };
        }

        const data = res.data as Record<string, unknown>;
        if (Array.isArray(data)) {
          return { success: false, error: `${path} is a directory, not a file.` };
        }
        if (data.type !== 'file') {
          return { success: false, error: `GitHub returned non-file content for ${path}.` };
        }
        const encoding = data.encoding;
        const content = data.content;
        if (encoding !== 'base64' || typeof content !== 'string') {
          return { success: false, error: 'Unexpected content encoding from GitHub API (expected base64 file).' };
        }
        const text = Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf-8');

        return {
          success: true,
          data: {
            path: data.path,
            sha: data.sha,
            size: data.size,
            content: text,
          },
        };
      },
    },
  ];
}
