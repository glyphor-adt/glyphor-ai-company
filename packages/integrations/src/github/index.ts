/**
 * GitHub Integration — Read/write access to Glyphor repos
 *
 * Used by Marcus (CTO), Jordan (DevOps), and Marcus's engineering team
 * to monitor CI/CD, review PRs, manage issues, and track code health.
 *
 * Requires GITHUB_TOKEN secret (Fine-Grained PAT with access to:
 *   glyphor-adt/glyphor-ai-company, fuse-builder, fuse-ui-registry, pulse)
 */

import { Octokit } from '@octokit/rest';

const ORG = 'glyphor-adt';

/** The repos Marcus's team actively monitors */
export const GLYPHOR_REPOS = {
  company: 'glyphor-ai-company',
  fuse: 'glyphor-ai-spark-c03e7e1a',
  pulse: 'glyphor-ally-ai',
} as const;

export type GlyphorRepo = keyof typeof GLYPHOR_REPOS;

let client: Octokit | null = null;

export function getGitHubClient(): Octokit {
  if (!client) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not configured — add the secret to Cloud Run');
    client = new Octokit({ auth: token });
  }
  return client;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  state: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  repo: string;
  ciStatus?: string;
  reviewStatus?: string;
  labels: string[];
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  commitSha: string;
  commitMessage: string;
  startedAt: string;
  updatedAt: string;
  url: string;
  repo: string;
}

export interface RepoStats {
  repo: string;
  openPRs: number;
  openIssues: number;
  lastPushAt: string;
  defaultBranch: string;
  ciPassRate?: number;
}

/** List open PRs across one or all repos */
export async function listOpenPRs(repoKey?: GlyphorRepo): Promise<PullRequest[]> {
  const gh = getGitHubClient();
  const repos = repoKey
    ? [{ key: repoKey, name: GLYPHOR_REPOS[repoKey] }]
    : Object.entries(GLYPHOR_REPOS).map(([key, name]) => ({ key, name }));

  const results: PullRequest[] = [];

  for (const { name } of repos) {
    try {
      const { data: prs } = await gh.pulls.list({
        owner: ORG,
        repo: name,
        state: 'open',
        per_page: 20,
      });

      for (const pr of prs) {
        // Get combined CI status
        let ciStatus: string | undefined;
        try {
          const { data: status } = await gh.repos.getCombinedStatusForRef({
            owner: ORG,
            repo: name,
            ref: pr.head.sha,
          });
          ciStatus = status.state; // 'success' | 'failure' | 'pending'
        } catch {
          ciStatus = undefined;
        }

        results.push({
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? 'unknown',
          state: pr.state,
          draft: pr.draft ?? false,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          url: pr.html_url,
          repo: name,
          ciStatus,
          reviewStatus: pr.requested_reviewers && pr.requested_reviewers.length > 0 ? 'review_requested' : 'no_reviewers',
          labels: pr.labels.map((l) => l.name ?? ''),
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes('Not Found')) {
        console.warn(`[GitHub] Failed to list PRs for ${name}:`, msg);
      }
    }
  }

  return results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Get recent workflow runs (CI/CD) for a repo */
export async function listWorkflowRuns(repoKey: GlyphorRepo, limit = 10): Promise<WorkflowRun[]> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.actions.listWorkflowRunsForRepo({
    owner: ORG,
    repo: repoName,
    per_page: limit,
  });

  return data.workflow_runs.map((run) => ({
    id: run.id,
    name: run.name ?? 'unknown',
    status: run.status ?? 'unknown',
    conclusion: run.conclusion,
    branch: run.head_branch ?? 'unknown',
    commitSha: run.head_sha.slice(0, 7),
    commitMessage: run.head_commit?.message?.split('\n')[0] ?? '',
    startedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
    url: run.html_url,
    repo: repoName,
  }));
}

/** Get high-level stats for a repo */
export async function getRepoStats(repoKey: GlyphorRepo): Promise<RepoStats> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data: repo } = await gh.repos.get({ owner: ORG, repo: repoName });

  // Get CI pass rate from last 20 runs
  let ciPassRate: number | undefined;
  try {
    const { data: runs } = await gh.actions.listWorkflowRunsForRepo({
      owner: ORG,
      repo: repoName,
      per_page: 20,
      status: 'completed',
    });
    if (runs.workflow_runs.length > 0) {
      const passed = runs.workflow_runs.filter((r) => r.conclusion === 'success').length;
      ciPassRate = Math.round((passed / runs.workflow_runs.length) * 100);
    }
  } catch {
    ciPassRate = undefined;
  }

  return {
    repo: repoName,
    openPRs: repo.open_issues_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    lastPushAt: repo.pushed_at ?? '',
    defaultBranch: repo.default_branch,
    ciPassRate,
  };
}

/** Create a GitHub issue on a repo */
export async function createIssue(
  repoKey: GlyphorRepo,
  title: string,
  body: string,
  labels?: string[],
): Promise<{ number: number; url: string }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.issues.create({
    owner: ORG,
    repo: repoName,
    title,
    body,
    labels,
  });

  return { number: data.number, url: data.html_url };
}

/** Get recent commits on default branch */
export async function listRecentCommits(repoKey: GlyphorRepo, limit = 10): Promise<Array<{
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}>> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.repos.listCommits({
    owner: ORG,
    repo: repoName,
    per_page: limit,
  });

  return data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
  }));
}

/** Comment on a PR */
export async function commentOnPR(
  repoKey: GlyphorRepo,
  prNumber: number,
  body: string,
): Promise<{ url: string }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.issues.createComment({
    owner: ORG,
    repo: repoName,
    issue_number: prNumber,
    body,
  });

  return { url: data.html_url };
}
