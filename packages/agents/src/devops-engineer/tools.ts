/**
 * DevOps Engineer (Jordan Hayes) — Tool Definitions
 * Tools for: CI/CD metrics, Cloud Build, cache optimization, resource utilization, cold start tracking.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  listWorkflowRuns, listRecentCommits, commentOnPR, createIssue,
  getFileContents, createOrUpdateFile, createBranch, createGitHubPR,
  GLYPHOR_REPOS, type GlyphorRepo,
  listCloudBuilds, getCloudBuildDetails,
  queryCloudRunMetrics, queryAllServices,
  submitPRReview, getPRDiff, type ReviewEvent,
} from '@glyphor/integrations';

export function createDevOpsEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  const SERVICE_IDS = ['glyphor-scheduler', 'glyphor-worker', 'glyphor-dashboard', 'glyphor-voice-gateway'];

  return [
    {
      name: 'query_cache_metrics',
      description: 'Get Cloud Run request/latency metrics to assess caching effectiveness across services.',
      parameters: {
        service: { type: 'string', description: 'Service: scheduler, worker, dashboard, voice-gateway (default: all)', required: false },
        hours: { type: 'number', description: 'Hours to look back (default: 6)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const hours = (params.hours as number) || 6;
          const service = params.service as string | undefined;
          if (service) {
            const serviceId = `glyphor-${service}`;
            const metrics = await queryCloudRunMetrics(projectId, serviceId, hours);
            return { success: true, data: { service: serviceId, metrics } };
          }
          const metrics = await queryAllServices(projectId, SERVICE_IDS, hours);
          return { success: true, data: { services: metrics } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'query_pipeline_metrics',
      description: 'Get real CI/CD build times, pass rates, and deploy frequency from GitHub Actions and Cloud Build.',
      parameters: {
        period: { type: 'string', description: 'Not used — always queries recent runs', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        const results: Record<string, unknown> = {};
        // GitHub Actions CI
        try {
          const runs = await listWorkflowRuns('company', 20);
          const completed = runs.filter(r => r.conclusion);
          const passed = completed.filter(r => r.conclusion === 'success');
          results.githubActions = {
            totalRuns: completed.length,
            passRate: completed.length > 0 ? Math.round((passed.length / completed.length) * 100) : null,
            recentFailures: completed.filter(r => r.conclusion === 'failure').slice(0, 3),
          };
        } catch (err) { results.githubActions = { error: (err as Error).message }; }
        // Cloud Build
        if (projectId) {
          try {
            const builds = await listCloudBuilds(projectId, 20);
            const passed = builds.filter(b => b.status === 'SUCCESS');
            const failed = builds.filter(b => b.status === 'FAILURE');
            results.cloudBuild = {
              totalBuilds: builds.length,
              passRate: builds.length > 0 ? Math.round((passed.length / builds.length) * 100) : null,
              failedCount: failed.length,
              recentFailures: failed.slice(0, 3),
            };
          } catch (err) { results.cloudBuild = { error: (err as Error).message }; }
        }
        return { success: true, data: results };
      },
    },
    {
      name: 'query_resource_utilization',
      description: 'Get real CPU, memory, request count, latency, and error rate for a Cloud Run service.',
      parameters: {
        service: { type: 'string', description: 'Service name: scheduler, worker, dashboard, voice-gateway', required: true, enum: ['scheduler', 'worker', 'dashboard', 'voice-gateway'] },
        hours: { type: 'number', description: 'Hours to look back (default: 6)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const serviceId = `glyphor-${params.service}`;
          const hours = (params.hours as number) || 6;
          const metrics = await queryCloudRunMetrics(projectId, serviceId, hours);
          return { success: true, data: metrics };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'query_cold_starts',
      description: 'Check if a Cloud Run service is scaled to zero (cold start risk) and get instance status.',
      parameters: {
        service: { type: 'string', description: 'Service name: scheduler, worker, dashboard, voice-gateway', required: true, enum: ['scheduler', 'worker', 'dashboard', 'voice-gateway'] },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const serviceId = `glyphor-${params.service}`;
          const metrics = await queryCloudRunMetrics(projectId, serviceId, 1);
          return {
            success: true,
            data: {
              service: serviceId,
              instanceCount: metrics.instanceCount,
              instanceStatus: metrics.instanceStatus,
              requestCount1h: metrics.requestCount,
              coldStartRisk: metrics.instanceStatus === 'scaled-to-zero' ? 'HIGH' : metrics.instanceStatus === 'scaling-down' ? 'MEDIUM' : 'LOW',
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'identify_unused_resources',
      description: 'Scan all Cloud Run services for zero-traffic or scaled-to-zero services that could be cleaned up.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const metrics = await queryAllServices(projectId, SERVICE_IDS, 24);
          const unused = metrics.filter(m => m.requestCount === 0 && m.instanceStatus === 'scaled-to-zero');
          const underused = metrics.filter(m => m.requestCount > 0 && m.requestCount < 10);
          return {
            success: true,
            data: {
              totalServices: metrics.length,
              unusedServices: unused.map(m => ({ service: m.service, status: m.instanceStatus })),
              underusedServices: underused.map(m => ({ service: m.service, requests24h: m.requestCount, status: m.instanceStatus })),
              allServices: metrics.map(m => ({ service: m.service, requests24h: m.requestCount, status: m.instanceStatus, errorRate: m.errorRate })),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'calculate_cost_savings',
      description: 'Project savings from a proposed optimization.',
      parameters: {
        optimization: { type: 'string', description: 'Description of the proposed optimization', required: true },
        current_monthly_cost: { type: 'number', description: 'Current monthly cost of the resource', required: true },
        projected_monthly_cost: { type: 'number', description: 'Projected cost after optimization', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const current = params.current_monthly_cost as number;
        const projected = params.projected_monthly_cost as number;
        const savings = current - projected;
        return {
          success: true,
          data: {
            optimization: params.optimization,
            currentMonthlyCost: current,
            projectedMonthlyCost: projected,
            monthlySavings: savings,
            annualSavings: savings * 12,
            savingsPercent: current > 0 ? `${((savings / current) * 100).toFixed(1)}%` : 'N/A',
          },
        };
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
          agentRole: ctx.agentRole, action: params.action as 'analysis',
          product: 'company', summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_pipeline_runs',
      description: 'Get recent GitHub Actions CI/CD workflow runs for a repo — shows pass/fail, branch, commit.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo to check: "company"',
          required: true,
          enum: ['company'],
        },
        limit: {
          type: 'number',
          description: 'Number of recent runs (default: 15)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const runs = await listWorkflowRuns(params.repo as GlyphorRepo, (params.limit as number) || 15);
          const failed = runs.filter((r) => r.conclusion === 'failure');
          return {
            success: true,
            data: {
              totalRuns: runs.length,
              failedRuns: failed.length,
              passRate: runs.length > 0 ? Math.round(((runs.length - failed.length) / runs.length) * 100) : null,
              recentFailures: failed.slice(0, 5),
              runs,
            },
          };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'get_recent_commits',
      description: 'Get recent commits on a repo — useful for tracking what shipped and correlating with incidents.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo to check: "company"',
          required: true,
          enum: ['company'],
        },
        limit: {
          type: 'number',
          description: 'Number of commits (default: 10)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const commits = await listRecentCommits(params.repo as GlyphorRepo, (params.limit as number) || 10);
          return { success: true, data: { commits } };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'comment_on_pr',
      description: 'Post a comment on a GitHub PR — use to flag CI failures, deployment notes, or review feedback.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo: "company"',
          required: true,
          enum: ['company'],
        },
        pr_number: {
          type: 'number',
          description: 'PR number',
          required: true,
        },
        comment: {
          type: 'string',
          description: 'Comment body (markdown)',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await commentOnPR(
            params.repo as GlyphorRepo,
            params.pr_number as number,
            params.comment as string,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    // ── CLOUD BUILD ───────────────────────────────────────────────

    {
      name: 'list_cloud_builds',
      description: 'List recent GCP Cloud Build runs — status, duration, trigger. Use to monitor CI/CD pipeline health.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default: 10)', required: false },
        status: { type: 'string', description: 'Filter by status: SUCCESS, FAILURE, WORKING, QUEUED', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const builds = await listCloudBuilds(
            projectId,
            (params.limit as number) || 10,
            params.status as string | undefined,
          );
          const failed = builds.filter((b) => b.status === 'FAILURE');
          return {
            success: true,
            data: {
              totalReturned: builds.length,
              failedCount: failed.length,
              builds,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_cloud_build_logs',
      description: 'Get detailed logs for a specific Cloud Build — step-by-step output, errors, and timing. Use to diagnose build failures.',
      parameters: {
        build_id: { type: 'string', description: 'Cloud Build ID (from list_cloud_builds)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const details = await getCloudBuildDetails(projectId, params.build_id as string);
          return { success: true, data: details };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── GITHUB ISSUE & CODE AUTHORING ─────────────────────────────

    {
      name: 'create_github_issue',
      description: 'Create a GitHub issue to track a CI/CD failure, infra problem, or optimization task.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        title: { type: 'string', description: 'Issue title', required: true },
        body: { type: 'string', description: 'Issue body (markdown)', required: true },
        labels: { type: 'array', description: 'Labels (e.g., ["bug", "ci/cd"])', required: false, items: { type: 'string', description: 'Label' } },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createIssue(
            params.repo as GlyphorRepo,
            params.title as string,
            params.body as string,
            (params.labels as string[]) ?? [],
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
      name: 'get_file_contents',
      description: 'Read a file from a GitHub repo — use to inspect Dockerfiles, cloudbuild.yaml, configs before proposing fixes.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        path: { type: 'string', description: 'File path in repo (e.g., "docker/Dockerfile.scheduler")', required: true },
        branch: { type: 'string', description: 'Branch name (default: main)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
          const contents = await getFileContents(
            repoName,
            params.path as string,
            (params.branch as string) ?? 'main',
          );
          if (!contents) return { success: false, error: `File not found: ${params.path}` };
          return { success: true, data: contents };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'create_fix_branch',
      description: 'Create a new branch for a CI/CD or infrastructure fix. Always branch from main.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        branch_name: { type: 'string', description: 'New branch name (e.g., "fix/dockerfile-scheduler")', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
          const result = await createBranch(repoName, params.branch_name as string);
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'push_file_fix',
      description: 'Create or update a file on a branch — use to push Dockerfile, cloudbuild.yaml, or config fixes.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        path: { type: 'string', description: 'File path in repo', required: true },
        content: { type: 'string', description: 'New file content', required: true },
        branch: { type: 'string', description: 'Branch to commit to (must already exist)', required: true },
        commit_message: { type: 'string', description: 'Commit message', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
          const result = await createOrUpdateFile(
            repoName,
            params.path as string,
            params.content as string,
            params.branch as string,
            params.commit_message as string,
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
      name: 'create_fix_pr',
      description: 'Open a PR for a CI/CD or infrastructure fix. Marcus must approve before merge.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        title: { type: 'string', description: 'PR title', required: true },
        body: { type: 'string', description: 'PR description (markdown)', required: true },
        head: { type: 'string', description: 'Source branch with the fix', required: true },
        base: { type: 'string', description: 'Target branch (default: main)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
          const result = await createGitHubPR(
            repoName,
            params.head as string,
            params.title as string,
            params.body as string,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    // ── PR REVIEW ───────────────────────────────────────────────

    {
      name: 'review_pr',
      description: 'Submit a formal review on a PR — approve, request changes, or comment. Focus on Dockerfiles, configs, infra changes.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        pr_number: { type: 'number', description: 'PR number', required: true },
        event: { type: 'string', description: 'Review action', required: true, enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
        body: { type: 'string', description: 'Review comment (markdown)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await submitPRReview(
            params.repo as GlyphorRepo,
            params.pr_number as number,
            params.event as ReviewEvent,
            `**DevOps Review (Jordan Hayes):**\n\n${params.body}`,
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
      description: 'Get the changed files and diff for a PR — review Dockerfiles, pipeline configs, and infra changes.',
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
  ];
}
