/**
 * Quality Engineer (Sam DeLuca) — Tool Definitions
 *
 * Tools for: build analysis, PR review, bug reporting, CI/CD visibility, check-run posting.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  listCloudBuilds, getCloudBuildDetails, resolveGcpProjectIdForCloudBuild,
  listWorkflowRuns, createIssueForCopilot, type GlyphorRepo,
  submitPRReview, getPRDiff, createCheckRun, listOpenPRs,
  type ReviewEvent,
} from '@glyphor/integrations';

export function createQualityEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_build_logs',
      description: 'Query real build outcomes from Cloud Build and GitHub Actions. Returns pass/fail stats and recent failures.',
      parameters: {
        source: { type: 'string', description: 'Build system: "cloud_build", "github_actions", or "all"', required: false, enum: ['cloud_build', 'github_actions', 'all'] },
        limit: { type: 'number', description: 'Max results per source (default: 10)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const limit = (params.limit as number) || 10;
        const source = (params.source as string) || 'all';
        const results: Record<string, unknown> = {};

        if (source === 'cloud_build' || source === 'all') {
          const projectId = resolveGcpProjectIdForCloudBuild();
          if (projectId) {
            try {
              const builds = await listCloudBuilds(projectId, limit);
              const failed = builds.filter(b => b.status === 'FAILURE');
              results.cloudBuild = { total: builds.length, failed: failed.length, passRate: builds.length > 0 ? Math.round(((builds.length - failed.length) / builds.length) * 100) : null, builds };
            } catch (err) { results.cloudBuild = { error: (err as Error).message }; }
          }
        }
        if (source === 'github_actions' || source === 'all') {
          try {
            const runs = await listWorkflowRuns('company', limit);
            const failed = runs.filter(r => r.conclusion === 'failure');
            results.githubActions = { total: runs.length, failed: failed.length, passRate: runs.length > 0 ? Math.round(((runs.length - failed.length) / runs.length) * 100) : null, runs };
          } catch (err) { results.githubActions = { error: (err as Error).message }; }
        }

        return { success: true, data: results };
      },
    },

    {
      name: 'query_error_patterns',
      description: 'Analyze recent build failures from Cloud Build and classify error patterns. Returns failure logs for triage.',
      parameters: {
        limit: { type: 'number', description: 'Number of recent failed builds to analyze (default: 5)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = resolveGcpProjectIdForCloudBuild();
        if (!projectId) {
          return { success: false, error: 'No GCP project id (set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT)' };
        }
        try {
          const builds = await listCloudBuilds(projectId, 20, 'FAILURE');
          const toAnalyze = builds.slice(0, (params.limit as number) || 5);
          const patterns: Array<{ buildId: string; trigger: string; failedAt: string; errorSummary: string }> = [];
          for (const build of toAnalyze) {
            try {
              const details = await getCloudBuildDetails(projectId, build.id);
              const failedSteps = (details as any).steps?.filter((s: any) => s.status === 'FAILURE') ?? [];
              patterns.push({
                buildId: build.id,
                trigger: build.trigger ?? 'unknown',
                failedAt: build.finishTime ?? build.startTime ?? '',
                errorSummary: failedSteps.length > 0
                  ? failedSteps.map((s: any) => `Step "${s.name}": ${s.exitCode ?? 'failed'}`).join('; ')
                  : 'See build logs for details',
              });
            } catch { patterns.push({ buildId: build.id, trigger: build.trigger ?? 'unknown', failedAt: '', errorSummary: 'Could not fetch details' }); }
          }
          return { success: true, data: { totalFailures: builds.length, analyzed: patterns } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_bug_report',
      description: 'File a bug report to Marcus\'s queue with severity classification.',
      parameters: {
        severity: { type: 'string', description: 'Bug severity', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', description: 'Bug title', required: true },
        description: { type: 'string', description: 'Detailed description with repro steps', required: true },
        product: { type: 'string', description: 'Affected component', required: true, enum: ['web-build', 'pulse', 'platform'] },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString();
        await memory.write(`bugs.${params.severity}.${date}`, {
          severity: params.severity,
          title: params.title,
          description: params.description,
          product: params.product,
          reporter: ctx.agentRole,
          createdAt: date,
        }, ctx.agentId);
        return { success: true, data: { filed: true, severity: params.severity }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'query_test_results',
      description: 'Get CI check status for open PRs — shows which PRs have passing/failing checks. Use for QA sign-off assessment.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: false, enum: ['company'] },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repo = (params.repo as GlyphorRepo) || 'company';
          const prs = await listOpenPRs(repo);
          const summary = prs.map(pr => ({
            number: pr.number,
            title: pr.title,
            author: pr.author,
            ciStatus: pr.ciStatus ?? 'unknown',
            reviewStatus: pr.reviewStatus,
            labels: pr.labels,
            url: pr.url,
          }));
          const passing = summary.filter(p => p.ciStatus === 'success').length;
          const failing = summary.filter(p => p.ciStatus === 'failure').length;
          return { success: true, data: { totalOpenPRs: summary.length, passing, failing, prs: summary } };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'log_activity',
      description: 'Log an activity to the company activity feed.',
      parameters: {
        action: { type: 'string', description: 'Action type', required: true, enum: ['analysis'] },
        summary: { type: 'string', description: 'Short summary', required: true },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis',
          product: 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    // ── CLOUD BUILD VISIBILITY ────────────────────────────────────

    {
      name: 'list_cloud_builds',
      description: 'List recent GCP Cloud Build runs — status, duration, trigger. Use to check build health and find failures to investigate.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default: 10)', required: false },
        status: { type: 'string', description: 'Filter: SUCCESS, FAILURE, WORKING, QUEUED', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = resolveGcpProjectIdForCloudBuild();
        if (!projectId) {
          return { success: false, error: 'No GCP project id (set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT)' };
        }
        try {
          const builds = await listCloudBuilds(projectId, (params.limit as number) || 10, params.status as string | undefined);
          const failed = builds.filter((b) => b.status === 'FAILURE');
          return { success: true, data: { totalReturned: builds.length, failedCount: failed.length, builds } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_cloud_build_logs',
      description: 'Get detailed logs for a specific Cloud Build — step-by-step output and errors. Use to classify and diagnose build failures.',
      parameters: {
        build_id: { type: 'string', description: 'Cloud Build ID', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = resolveGcpProjectIdForCloudBuild();
        if (!projectId) {
          return { success: false, error: 'No GCP project id (set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT)' };
        }
        try {
          const details = await getCloudBuildDetails(projectId, params.build_id as string);
          return { success: true, data: details };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── GITHUB ACTIONS VISIBILITY ─────────────────────────────────

    {
      name: 'get_github_actions_runs',
      description: 'Get recent GitHub Actions workflow runs — pass/fail, branch, commit. Use alongside Cloud Build for full CI/CD visibility.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        limit: { type: 'number', description: 'Number of recent runs (default: 15)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const runs = await listWorkflowRuns(params.repo as GlyphorRepo, (params.limit as number) || 15);
          const failed = runs.filter((r) => r.conclusion === 'failure');
          return {
            success: true,
            data: { totalRuns: runs.length, failedRuns: failed.length, passRate: runs.length > 0 ? Math.round(((runs.length - failed.length) / runs.length) * 100) : null, recentFailures: failed.slice(0, 5), runs },
          };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    // ── BUG FILING TO GITHUB ──────────────────────────────────────

    {
      name: 'create_github_bug',
      description: 'File a bug as a GitHub Issue with severity label — use for P0/P1 issues that need tracking beyond memory.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        severity: { type: 'string', description: 'Bug severity', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', description: 'Bug title', required: true },
        body: { type: 'string', description: 'Bug description with repro steps (markdown)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createIssueForCopilot(
            params.repo as GlyphorRepo,
            `[${params.severity}] ${params.title}`,
            params.body as string,
            ['bug', (params.severity as string).toLowerCase()],
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    // ── PR REVIEW & QA GATES ────────────────────────────────────

    {
      name: 'review_pr',
      description: 'Submit a formal code review on a PR — approve, request changes, or comment. Use after reviewing the diff.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        pr_number: { type: 'number', description: 'PR number', required: true },
        event: { type: 'string', description: 'Review action', required: true, enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
        body: { type: 'string', description: 'Review comment (markdown) — explain why you approve or what needs fixing', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await submitPRReview(
            params.repo as GlyphorRepo,
            params.pr_number as number,
            params.event as ReviewEvent,
            `**QA Review (Sam DeLuca):**\n\n${params.body}`,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'get_pr_diff',
      description: 'Get the changed files and diff for a PR — use to review code before approving or requesting changes.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        pr_number: { type: 'number', description: 'PR number', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await getPRDiff(params.repo as GlyphorRepo, params.pr_number as number);
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'post_qa_check',
      description: 'Post a QA check status on a PR commit — shows as a pass/fail check in the PR. Use to gate merges on QA sign-off.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        commit_sha: { type: 'string', description: 'Full commit SHA to post the check on', required: true },
        conclusion: { type: 'string', description: 'Check result', required: true, enum: ['success', 'failure', 'neutral'] },
        summary: { type: 'string', description: 'QA summary (markdown)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createCheckRun(
            params.repo as GlyphorRepo,
            params.commit_sha as string,
            'QA Sign-off (Sam DeLuca)',
            params.conclusion as 'success' | 'failure' | 'neutral',
            params.summary as string,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },
  ];
}
