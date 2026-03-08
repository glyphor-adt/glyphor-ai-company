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
const REPO_CONTEXT_CHAR_LIMIT = 12000;

/** The repos Marcus's team actively monitors */
export const GLYPHOR_REPOS = {
  company: 'glyphor-ai-company',
  fuse: 'glyphor-ai-spark-c03e7e1a',
  pulse: 'glyphor-ally-ai',
} as const;

export type GlyphorRepo = keyof typeof GLYPHOR_REPOS;

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function normalizeRepoName(repo: string): string | null {
  if ((repo as GlyphorRepo) in GLYPHOR_REPOS) {
    return GLYPHOR_REPOS[repo as GlyphorRepo];
  }

  return Object.values(GLYPHOR_REPOS).includes(repo as (typeof GLYPHOR_REPOS)[GlyphorRepo]) ? repo : null;
}

function buildSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9._/-]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3),
    ),
  ).slice(0, 6);
}

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

// ═══════════════════════════════════════════════════════════════════
// CODE AUTHORING — Read/write files and branches for agent self-extension
// ═══════════════════════════════════════════════════════════════════

export interface FileContents {
  content: string;
  sha: string;
  size: number;
  path: string;
}

export interface GitHubRepoContextResult {
  repos: string[];
  context: string;
}

/** Read a file from a GitHub repo. Returns null if file doesn't exist (404). */
export async function getFileContents(
  repoName: string,
  path: string,
  ref?: string,
): Promise<FileContents | null> {
  const gh = getGitHubClient();
  try {
    const { data } = await gh.repos.getContent({
      owner: ORG,
      repo: repoName,
      path,
      ...(ref ? { ref } : {}),
    });

    if (Array.isArray(data) || data.type !== 'file') {
      return null; // Directory, not a file
    }

    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha,
      size: data.size,
      path: data.path,
    };
  } catch (err) {
    if ((err as any).status === 404) return null;
    throw err;
  }
}

export async function buildGitHubRepoContext(
  repos: string[],
  query: string,
): Promise<GitHubRepoContextResult> {
  const gh = getGitHubClient();
  const repoNames = Array.from(new Set(repos.map(normalizeRepoName).filter((repo): repo is string => Boolean(repo))));

  if (repoNames.length === 0) {
    return { repos: [], context: '' };
  }

  const searchTerms = buildSearchTerms(query);
  const sections: string[] = [];
  let totalChars = 0;

  for (const repoName of repoNames) {
    if (totalChars >= REPO_CONTEXT_CHAR_LIMIT) break;

    const lines: string[] = [`### Repository: ${repoName}`];

    try {
      const { data: repo } = await gh.repos.get({ owner: ORG, repo: repoName });
      lines.push(`Description: ${repo.description ?? 'n/a'}`);
      lines.push(`Default branch: ${repo.default_branch}`);
      if (repo.pushed_at) lines.push(`Last push: ${repo.pushed_at}`);
    } catch {
      lines.push('Repository metadata unavailable.');
    }

    const fallbackFiles = ['README.md', 'package.json', 'docs/README.md', 'docs/ARCHITECTURE.md'];
    const includedPaths = new Set<string>();

    if (searchTerms.length > 0) {
      try {
        const { data } = await gh.search.code({
          q: `${searchTerms.join(' ')} repo:${ORG}/${repoName}`,
          per_page: 4,
        });

        for (const item of data.items) {
          if (includedPaths.has(item.path)) continue;
          const file = await getFileContents(repoName, item.path);
          if (!file?.content) continue;
          includedPaths.add(item.path);
          lines.push(`\n[Search match] ${file.path}`);
          lines.push(truncate(file.content, 1800));
          if (lines.join('\n').length >= REPO_CONTEXT_CHAR_LIMIT) break;
        }
      } catch {
        lines.push('Code search unavailable; falling back to repo summary files.');
      }
    }

    for (const path of fallbackFiles) {
      if (includedPaths.has(path)) continue;
      const file = await getFileContents(repoName, path);
      if (!file?.content) continue;
      includedPaths.add(path);
      lines.push(`\n[Reference file] ${file.path}`);
      lines.push(truncate(file.content, path.endsWith('package.json') ? 1200 : 1800));
      if (lines.join('\n').length >= REPO_CONTEXT_CHAR_LIMIT) break;
    }

    const section = lines.join('\n');
    if (!section.trim()) continue;
    sections.push(section);
    totalChars += section.length;
  }

  const context = truncate(sections.join('\n\n'), REPO_CONTEXT_CHAR_LIMIT);
  return { repos: repoNames, context };
}

/** Create or update a file on a branch. Automatically detects create vs update. */
export async function createOrUpdateFile(
  repoName: string,
  path: string,
  content: string,
  branch: string,
  commitMessage: string,
): Promise<{ commit_sha: string; path: string; created_or_updated: 'created' | 'updated' }> {
  const gh = getGitHubClient();

  // Check if file already exists on this branch to get its SHA
  const existing = await getFileContents(repoName, path, branch);

  const body: Parameters<typeof gh.repos.createOrUpdateFileContents>[0] = {
    owner: ORG,
    repo: repoName,
    path,
    message: commitMessage,
    content: Buffer.from(content).toString('base64'),
    branch,
  };

  if (existing) {
    body.sha = existing.sha;
  }

  const { data } = await gh.repos.createOrUpdateFileContents(body);

  return {
    commit_sha: data.commit.sha!,
    path,
    created_or_updated: existing ? 'updated' : 'created',
  };
}

/** Create a new branch from a ref (defaults to 'main'). */
export async function createBranch(
  repoName: string,
  branchName: string,
  fromRef = 'main',
): Promise<{ branch: string; sha: string; created: true }> {
  const gh = getGitHubClient();

  // Get the SHA of the source ref
  const { data: refData } = await gh.git.getRef({
    owner: ORG,
    repo: repoName,
    ref: `heads/${fromRef}`,
  });

  // Create the new branch
  await gh.git.createRef({
    owner: ORG,
    repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
  });

  return {
    branch: branchName,
    sha: refData.object.sha,
    created: true,
  };
}

/** Create a pull request */
export async function createGitHubPR(
  repoName: string,
  branch: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const gh = getGitHubClient();

  const { data } = await gh.pulls.create({
    owner: ORG,
    repo: repoName,
    head: branch,
    base: 'main',
    title,
    body,
  });

  return { number: data.number, url: data.html_url };
}

/** Merge a pull request */
export async function mergeGitHubPR(
  repoName: string,
  prNumber: number,
): Promise<{ merged: boolean; sha: string; message: string }> {
  const gh = getGitHubClient();

  const { data } = await gh.pulls.merge({
    owner: ORG,
    repo: repoName,
    pull_number: prNumber,
    merge_method: 'squash',
  });

  return {
    merged: data.merged,
    sha: data.sha,
    message: data.message,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PR REVIEW & QA — Submit formal reviews and quality checks
// ═══════════════════════════════════════════════════════════════════

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/** Submit a formal PR review (approve, request changes, or comment) */
export async function submitPRReview(
  repoKey: GlyphorRepo,
  prNumber: number,
  event: ReviewEvent,
  body: string,
): Promise<{ id: number; state: string; url: string }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.pulls.createReview({
    owner: ORG,
    repo: repoName,
    pull_number: prNumber,
    event,
    body,
  });

  return {
    id: data.id,
    state: data.state,
    url: data.html_url,
  };
}

/** Get the diff/changed files for a PR — used for code review */
export async function getPRDiff(
  repoKey: GlyphorRepo,
  prNumber: number,
): Promise<{ files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>; totalChanges: number }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.pulls.listFiles({
    owner: ORG,
    repo: repoName,
    pull_number: prNumber,
    per_page: 100,
  });

  return {
    files: data.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch?.slice(0, 3000), // Truncate large diffs
    })),
    totalChanges: data.reduce((sum, f) => sum + f.changes, 0),
  };
}

/** Create a check run on a commit — lets QA post pass/fail status on PRs */
export async function createCheckRun(
  repoKey: GlyphorRepo,
  headSha: string,
  name: string,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  details?: string,
): Promise<{ id: number; url: string }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.checks.create({
    owner: ORG,
    repo: repoName,
    head_sha: headSha,
    name,
    status: 'completed',
    conclusion,
    output: {
      title: name,
      summary,
      text: details,
    },
  });

  return {
    id: data.id,
    url: data.html_url ?? '',
  };
}

// ═══════════════════════════════════════════════════════════════════
// COPILOT CODING AGENT — Create issues assigned to GitHub Copilot
// ═══════════════════════════════════════════════════════════════════

/** Create a GitHub issue labeled for Copilot coding agent to implement */
export async function createIssueForCopilot(
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
    labels: [...(labels ?? []), 'copilot'],
    assignees: ['Copilot'],
  });

  return { number: data.number, url: data.html_url };
}

/** Find a PR linked to a specific GitHub issue number */
export async function findPRForIssue(
  repoKey: GlyphorRepo,
  issueNumber: number,
): Promise<{ number: number; url: string; branch: string; state: string; draft: boolean; sha: string } | null> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  // List recent PRs and find one that references this issue
  const { data: prs } = await gh.pulls.list({
    owner: ORG,
    repo: repoName,
    state: 'all',
    per_page: 30,
    sort: 'created',
    direction: 'desc',
  });

  // Copilot typically links to the issue in the PR body or branch name
  for (const pr of prs) {
    const refersToIssue =
      pr.body?.includes(`#${issueNumber}`) ||
      pr.body?.includes(`issues/${issueNumber}`) ||
      pr.head.ref.includes(`issue-${issueNumber}`) ||
      pr.head.ref.includes(`copilot/fix-${issueNumber}`);

    if (refersToIssue) {
      return {
        number: pr.number,
        url: pr.html_url,
        branch: pr.head.ref,
        state: pr.state,
        draft: pr.draft ?? false,
        sha: pr.head.sha,
      };
    }
  }

  return null;
}

/** Get issue details (to check if Copilot has started work) */
export async function getIssueDetails(
  repoKey: GlyphorRepo,
  issueNumber: number,
): Promise<{ number: number; state: string; assignees: string[]; labels: string[]; url: string }> {
  const gh = getGitHubClient();
  const repoName = GLYPHOR_REPOS[repoKey];

  const { data } = await gh.issues.get({
    owner: ORG,
    repo: repoName,
    issue_number: issueNumber,
  });

  return {
    number: data.number,
    state: data.state,
    assignees: (data.assignees ?? []).map(a => a?.login ?? ''),
    labels: (data.labels ?? []).map(l => typeof l === 'string' ? l : l.name ?? ''),
    url: data.html_url,
  };
}
