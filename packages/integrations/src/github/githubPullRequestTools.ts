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
  repo: string,
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await getWebsitePipelineGitHubToken(repo);
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

function formatGithubRestError(data: unknown): string {
  const err = data as Record<string, unknown> | null;
  const message = String(err?.message ?? 'Unknown GitHub API error');
  const errors = err?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return message;
  }
  const details = errors
    .map((e) => {
      if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        const parts = [o.field, o.message, o.code].filter(
          (x) => x !== undefined && x !== null && String(x).length > 0,
        );
        return parts.length > 0 ? parts.map(String).join(' ') : JSON.stringify(o);
      }
      return String(e);
    })
    .join('; ');
  return `${message} | ${details}`;
}

function classifyCheckState(state: string, conclusion?: string | null): 'success' | 'pending' | 'failure' {
  const normalizedState = state.toLowerCase();
  const normalizedConclusion = (conclusion ?? '').toLowerCase();

  if (normalizedState === 'queued' || normalizedState === 'in_progress' || normalizedState === 'pending') {
    return 'pending';
  }

  if (['failure', 'failed', 'timed_out', 'cancelled', 'cancel', 'action_required', 'startup_failure'].includes(normalizedConclusion)) {
    return 'failure';
  }

  if (normalizedState === 'failure' || normalizedState === 'error') {
    return 'failure';
  }

  if (normalizedState === 'success' || ['success', 'neutral', 'skipped'].includes(normalizedConclusion)) {
    return 'success';
  }

  return 'pending';
}

function summarizeCheckRollup(items: Array<'success' | 'pending' | 'failure'>): 'success' | 'pending' | 'failure' {
  if (items.some((item) => item === 'failure')) return 'failure';
  if (items.some((item) => item === 'pending')) return 'pending';
  return 'success';
}

async function getPullRequestStatus(
  repoInput: string,
  prNumber: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const { owner, name, fullName } = parseRepoFullName(repoInput);

  const prResponse = await githubRequest(
    fullName,
    `/repos/${owner}/${name}/pulls/${prNumber}`,
    'GET',
    undefined,
    signal,
  );
  if (!prResponse.ok) {
    return {
      success: false,
      error: `GitHub API error (${prResponse.status}): ${formatGithubRestError(prResponse.data)}`,
    };
  }

  const pr = prResponse.data as Record<string, unknown>;
  const head = (pr.head as Record<string, unknown> | undefined) ?? {};
  const sha = String(head.sha ?? '').trim();

  let statusState: 'success' | 'pending' | 'failure' = 'pending';
  let statusContexts: Array<Record<string, unknown>> = [];
  if (sha) {
    const statusResponse = await githubRequest(
      fullName,
      `/repos/${owner}/${name}/commits/${sha}/status`,
      'GET',
      undefined,
      signal,
    );
    if (statusResponse.ok) {
      const statusData = statusResponse.data as Record<string, unknown>;
      const combined = String(statusData.state ?? 'pending').toLowerCase();
      if (combined === 'success') statusState = 'success';
      else if (combined === 'failure' || combined === 'error') statusState = 'failure';

      statusContexts = ((statusData.statuses as unknown[]) ?? []).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          context: String(item.context ?? ''),
          state: String(item.state ?? ''),
          description: String(item.description ?? ''),
          target_url: String(item.target_url ?? ''),
        };
      });
    }
  }

  let checkRuns: Array<Record<string, unknown>> = [];
  let checkRunsState: 'success' | 'pending' | 'failure' = statusState;
  if (sha) {
    const checksResponse = await githubRequest(
      fullName,
      `/repos/${owner}/${name}/commits/${sha}/check-runs`,
      'GET',
      undefined,
      signal,
    );
    if (checksResponse.ok) {
      const checksData = checksResponse.data as Record<string, unknown>;
      checkRuns = ((checksData.check_runs as unknown[]) ?? []).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          name: String(item.name ?? ''),
          status: String(item.status ?? ''),
          conclusion: item.conclusion == null ? null : String(item.conclusion),
          details_url: String(item.details_url ?? ''),
        };
      });
      if (checkRuns.length > 0) {
        checkRunsState = summarizeCheckRollup(
          checkRuns.map((entry) => classifyCheckState(String(entry.status ?? ''), entry.conclusion as string | null | undefined)),
        );
      }
    }
  }

  const overallChecksState = summarizeCheckRollup([statusState, checkRunsState]);
  const mergeable = pr.mergeable == null ? null : Boolean(pr.mergeable);
  const draft = Boolean(pr.draft);
  const state = String(pr.state ?? 'unknown');

  return {
    success: true,
    data: {
      repo: fullName,
      pr_number: prNumber,
      title: String(pr.title ?? ''),
      state,
      draft,
      mergeable,
      mergeable_state: String(pr.mergeable_state ?? ''),
      head_sha: sha,
      head_branch: String((head.ref as string | undefined) ?? ''),
      base_branch: String(((pr.base as Record<string, unknown> | undefined)?.ref as string | undefined) ?? ''),
      pr_url: String(pr.html_url ?? ''),
      overall_checks_state: overallChecksState,
      status_state: statusState,
      check_runs_state: checkRunsState,
      status_contexts: statusContexts,
      check_runs: checkRuns,
      ready_to_merge: state === 'open' && !draft && mergeable === true && overallChecksState === 'success',
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGithubPullRequestTools(): ToolDefinition[] {
  return [
    {
      name: 'github_list_branches',
      description: 'List branches for an arbitrary GitHub repository in owner/name format. Use this to discover unmerged feature branches without using terminal commands.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        prefix: {
          type: 'string',
          description: 'Optional branch prefix filter (for example: feature/).',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of branches to return. Defaults to 100, max 200.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoInput = String(params.repo ?? '').trim();
        const prefix = String(params.prefix ?? '').trim();
        const limit = Math.max(1, Math.min(200, Number(params.limit ?? 100)));

        if (!repoInput) return { success: false, error: 'repo is required.' };

        try {
          const { owner, name, fullName } = parseRepoFullName(repoInput);
          const perPage = Math.min(100, limit);
          const pages = Math.max(1, Math.ceil(limit / perPage));
          const branches: Array<Record<string, unknown>> = [];

          for (let page = 1; page <= pages && branches.length < limit; page += 1) {
            const { ok, status, data } = await githubRequest(
              fullName,
              `/repos/${owner}/${name}/branches?per_page=${perPage}&page=${page}`,
              'GET',
              undefined,
              ctx.abortSignal,
            );

            if (!ok) {
              return { success: false, error: `GitHub API error (${status}): ${formatGithubRestError(data)}` };
            }

            const batch = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
            if (batch.length === 0) break;

            for (const item of batch) {
              const branchName = String(item.name ?? '').trim();
              if (!branchName) continue;
              if (prefix && !branchName.startsWith(prefix)) continue;

              const commit = (item.commit as Record<string, unknown> | undefined) ?? {};
              branches.push({
                name: branchName,
                protected: Boolean(item.protected),
                commit_sha: String(commit.sha ?? ''),
              });

              if (branches.length >= limit) break;
            }

            if (batch.length < perPage) break;
          }

          return {
            success: true,
            data: {
              repo: fullName,
              prefix: prefix || null,
              total_returned: branches.length,
              branches,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to list branches: ${(err as Error).message}`,
          };
        }
      },
    },
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
            fullName,
            `/repos/${owner}/${name}/pulls`,
            'POST',
            {
              title,
              head: headBranch,
              base: baseBranch,
              body: body || undefined,
              draft,
            },
            ctx.abortSignal,
          );

          if (!ok) {
            return { success: false, error: `GitHub API error (${status}): ${formatGithubRestError(data)}` };
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
      name: 'github_get_pull_request_status',
      description: 'Get merge readiness and CI/check status for a pull request in an arbitrary GitHub repository in owner/name format.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        pr_number: {
          type: 'number',
          description: 'Pull request number to inspect.',
          required: true,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoInput = String(params.repo ?? '').trim();
        const prNumber = Number(params.pr_number ?? NaN);

        if (!repoInput) return { success: false, error: 'repo is required.' };
        if (!Number.isFinite(prNumber) || prNumber <= 0) {
          return { success: false, error: 'pr_number must be a positive number.' };
        }

        try {
          const result = await getPullRequestStatus(repoInput, prNumber, ctx.abortSignal);
          if (!result.success) {
            return { success: false, error: result.error ?? 'Failed to fetch pull request status.' };
          }
          return { success: true, data: result.data };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get pull request status: ${(err as Error).message}`,
          };
        }
      },
    },
    {
      name: 'github_wait_for_pull_request_checks',
      description: 'Poll a pull request in an arbitrary GitHub repository until checks succeed, fail, or timeout.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository in owner/name format.',
          required: true,
        },
        pr_number: {
          type: 'number',
          description: 'Pull request number to monitor.',
          required: true,
        },
        timeout_seconds: {
          type: 'number',
          description: 'Maximum time to wait. Defaults to 900 seconds.',
          required: false,
        },
        poll_interval_seconds: {
          type: 'number',
          description: 'Polling interval. Defaults to 15 seconds.',
          required: false,
        },
      },
      async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const repoInput = String(params.repo ?? '').trim();
        const prNumber = Number(params.pr_number ?? NaN);
        const timeoutSeconds = Math.max(30, Number(params.timeout_seconds ?? 900));
        const pollIntervalSeconds = Math.max(5, Number(params.poll_interval_seconds ?? 15));

        if (!repoInput) return { success: false, error: 'repo is required.' };
        if (!Number.isFinite(prNumber) || prNumber <= 0) {
          return { success: false, error: 'pr_number must be a positive number.' };
        }

        const deadline = Date.now() + timeoutSeconds * 1000;

        try {
          while (Date.now() < deadline) {
            const result = await getPullRequestStatus(repoInput, prNumber, ctx.abortSignal);
            if (!result.success) {
              return { success: false, error: result.error ?? 'Failed to fetch pull request status.' };
            }

            const data = result.data as Record<string, unknown>;
            const checksState = String(data.overall_checks_state ?? 'pending');
            const readyToMerge = data.ready_to_merge === true;
            if (readyToMerge) {
              return { success: true, data: { ...data, wait_result: 'success' } };
            }
            if (checksState === 'failure') {
              return { success: false, error: 'Pull request checks failed.', data: { ...data, wait_result: 'failure' } };
            }

            await sleep(pollIntervalSeconds * 1000);
          }

          const lastResult = await getPullRequestStatus(repoInput, prNumber, ctx.abortSignal);
          if (!lastResult.success) {
            return { success: false, error: lastResult.error ?? 'Timed out while waiting for pull request checks.' };
          }

          return {
            success: false,
            error: `Timed out waiting for pull request checks after ${timeoutSeconds} seconds.`,
            data: { ...(lastResult.data ?? {}), wait_result: 'timeout' },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed while waiting for pull request checks: ${(err as Error).message}`,
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
            fullName,
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
            return { success: false, error: `GitHub API error (${status}): ${formatGithubRestError(data)}` };
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