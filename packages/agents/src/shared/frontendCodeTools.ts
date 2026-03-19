/**
 * Frontend Code Tools — Path-scoped read/write access to frontend codebases
 *
 * Tools:
 *   read_frontend_file       — Read files under allowed frontend paths
 *   search_frontend_code     — Search across frontend codebases
 *   list_frontend_files      — Browse frontend directory tree
 *   write_frontend_file      — Create/update files on design/frontend branches
 *   create_design_branch     — Create feature/design-* branches
 *   create_git_branch        — Create feature/design-* or feature/frontend-* branches
 *   create_frontend_pr       — Open PR from design branch
 *   check_pr_status          — Check CI status on design PRs
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  getFileContents,
  createOrUpdateFile,
  createBranch,
  createGitHubPR,
  listOpenPRs,
  GLYPHOR_REPOS,
  type GlyphorRepo,
} from '@glyphor/integrations';
import { getGitHubClient } from '@glyphor/integrations';

const ALLOWED_PREFIXES = [
  'packages/dashboard/src/components/',
  'packages/dashboard/src/pages/',
  'packages/dashboard/src/styles/',
  'packages/dashboard/src/theme/',
  'packages/dashboard/src/assets/',
  'packages/dashboard/tailwind.config',
  'packages/dashboard/postcss.config',
  'packages/dashboard/next.config',
  'packages/dashboard/tsconfig',
  'packages/dashboard/package.json',
  'packages/pulse/src/components/',
  'packages/pulse/src/pages/',
  'packages/pulse/src/styles/',
  'packages/pulse/tailwind.config',
  'packages/pulse/postcss.config',
  'packages/pulse/next.config',
  'packages/pulse/tsconfig',
  'packages/pulse/package.json',
  'packages/shared-ui/',
  'packages/design-tokens/',
];

const BLOCKED_PREFIXES = [
  'packages/agent-runtime/',
  'packages/scheduler/',
  'packages/agents/',
  'infra/',
  '.github/',
  'docker/',
];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PREFIXES.some(p => path.startsWith(p));
}

export function createFrontendCodeTools(): ToolDefinition[] {
  return [
    /* ─── Read frontend file ─── */
    {
      name: 'read_frontend_file',
      description:
        'Read file content from allowed frontend paths (dashboard components/pages/styles/theme/assets, ' +
        'pulse components/pages/styles, shared-ui, design-tokens).',
      parameters: {
        path: {
          type: 'string',
          description: 'File path within the repo (must be under an allowed frontend prefix)',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
        branch: {
          type: 'string',
          description: 'Branch name to read from (defaults to main)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const filePath = params.path as string;
          if (!isAllowedPath(filePath)) {
            return { success: false, error: `Path "${filePath}" is outside allowed frontend directories` };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          const result = await getFileContents(repoName, filePath, params.branch as string | undefined);
          if (!result) return { success: false, error: `File not found: ${filePath}` };
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: `Failed to read file: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Search frontend code ─── */
    {
      name: 'search_frontend_code',
      description:
        'Search across frontend codebases for code patterns, component names, or style references. ' +
        'Scoped to dashboard, pulse, shared-ui, and design-tokens directories.',
      parameters: {
        query: {
          type: 'string',
          description: 'The search term to find in frontend code',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const query = params.query as string;
          if (!query) return { success: false, error: 'Missing required parameter: query' };
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          const gh = getGitHubClient();
          const pathScopes = [
            'path:packages/dashboard',
            'path:packages/pulse',
            'path:packages/shared-ui',
            'path:packages/design-tokens',
          ];
          const q = `${query} repo:glyphor-adt/${repoName} ${pathScopes.join(' ')}`;
          const response = await gh.search.code({
            q,
            headers: { accept: 'application/vnd.github.text-match+json' },
          });
          const results = response.data.items.slice(0, 20).map((item) => ({
            file: item.path,
            matches: (item as Record<string, unknown> & { text_matches?: { fragment: string }[] }).text_matches?.map((m) => m.fragment) ?? [],
          }));
          return { success: true, data: { total: response.data.total_count, results } };
        } catch (err) {
          return { success: false, error: `Search failed: ${(err as Error).message}` };
        }
      },
    },

    /* ─── List frontend files ─── */
    {
      name: 'list_frontend_files',
      description:
        'List files in a frontend directory. Only works under allowed frontend path prefixes.',
      parameters: {
        path: {
          type: 'string',
          description: 'Directory path within the repo',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const dirPath = params.path as string;
          if (!isAllowedPath(dirPath)) {
            return { success: false, error: `Path "${dirPath}" is outside allowed frontend directories` };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          const gh = getGitHubClient();
          const response = await gh.repos.getContent({ owner: 'glyphor-adt', repo: repoName, path: dirPath });
          if (!Array.isArray(response.data)) {
            return { success: false, error: `Path "${dirPath}" is a file, not a directory` };
          }
          const files = response.data.map((item) => ({
            name: item.name,
            type: item.type,
            path: item.path,
            size: item.size,
          }));
          return { success: true, data: files };
        } catch (err) {
          return { success: false, error: `Failed to list files: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Write frontend file ─── */
    {
      name: 'write_frontend_file',
      description:
        'Create or update a file on a feature/design-* or feature/frontend-* branch. Only works under allowed frontend ' +
        'path prefixes and only on branches starting with "feature/design-" or "feature/frontend-".',
      parameters: {
        path: {
          type: 'string',
          description: 'File path within the repo',
          required: true,
        },
        content: {
          type: 'string',
          description: 'File content to write',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Target branch (must start with "feature/design-" or "feature/frontend-")',
          required: true,
        },
        commit_message: {
          type: 'string',
          description: 'Commit message for the change',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const filePath = params.path as string;
          const branch = params.branch as string;
          if (!branch.startsWith('feature/design-') && !branch.startsWith('feature/frontend-')) {
            return { success: false, error: 'Branch must start with "feature/design-" or "feature/frontend-"' };
          }
          if (!isAllowedPath(filePath)) {
            return { success: false, error: `Path "${filePath}" is outside allowed frontend directories` };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          await createOrUpdateFile(
            repoName,
            filePath,
            params.content as string,
            params.commit_message as string,
            branch,
          );
          return { success: true, data: `Wrote ${filePath} to ${branch}` };
        } catch (err) {
          return { success: false, error: `Failed to write file: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Create design branch ─── */
    {
      name: 'create_design_branch',
      description:
        'Create a feature/design-* branch from main for design team changes.',
      parameters: {
        branch_name: {
          type: 'string',
          description: 'Branch name (must start with "feature/design-")',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const branchName = params.branch_name as string;
          if (!branchName.startsWith('feature/design-')) {
            return { success: false, error: 'Branch name must start with "feature/design-"' };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          await createBranch(repoName, branchName);
          return { success: true, data: `Branch "${branchName}" created from main` };
        } catch (err) {
          return { success: false, error: `Failed to create branch: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Create git branch (general-purpose) ─── */
    {
      name: 'create_git_branch',
      description:
        'Create a new branch from main for frontend work. ' +
        'Branch name must start with "feature/design-" or "feature/frontend-".',
      parameters: {
        branch_name: {
          type: 'string',
          description: 'Branch name (must start with "feature/design-" or "feature/frontend-")',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const branchName = params.branch_name as string;
          if (!branchName.startsWith('feature/design-') && !branchName.startsWith('feature/frontend-')) {
            return { success: false, error: 'Branch name must start with "feature/design-" or "feature/frontend-"' };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company` };
          await createBranch(repoName, branchName);
          return { success: true, data: `Branch "${branchName}" created from main` };
        } catch (err) {
          return { success: false, error: `Failed to create branch: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Create frontend PR ─── */
    {
      name: 'create_frontend_pr',
      description:
        'Open a pull request from a design branch to main for frontend changes.',
      parameters: {
        branch: {
          type: 'string',
          description: 'Source branch name',
          required: true,
        },
        title: {
          type: 'string',
          description: 'PR title',
          required: true,
        },
        body: {
          type: 'string',
          description: 'PR description with design context and change summary',
          required: true,
        },
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          if (!params.branch || !params.title || !params.body) {
            return { success: false, error: 'Missing required parameters: branch, title, body' };
          }
          const repo = (params.repo as GlyphorRepo) || 'company';
          const repoName = GLYPHOR_REPOS[repo];
          if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, pulse` };
          const pr = await createGitHubPR(
            repoName,
            params.branch as string,
            params.title as string,
            params.body as string,
          );
          return { success: true, data: pr };
        } catch (err) {
          return { success: false, error: `Failed to create PR: ${(err as Error).message}` };
        }
      },
    },

    /* ─── Check PR status ─── */
    {
      name: 'check_pr_status',
      description:
        'Check CI status on open design PRs (feature/design-* branches).',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key (defaults to company)',
          required: false,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const repo = (params.repo as GlyphorRepo) || 'company';
          const prs = await listOpenPRs(repo);
          const designPRs = prs.filter(
            (pr) => pr.title?.includes('design') || pr.url?.includes('feature/design-'),
          );
          const results = designPRs.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.author,
            ciStatus: pr.ciStatus ?? 'unknown',
            reviewStatus: pr.reviewStatus ?? 'unknown',
            url: pr.url,
          }));
          return { success: true, data: results };
        } catch (err) {
          return { success: false, error: `Failed to check PR status: ${(err as Error).message}` };
        }
      },
    },
  ];
}
