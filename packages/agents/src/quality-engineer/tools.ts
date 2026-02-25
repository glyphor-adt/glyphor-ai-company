/**
 * Quality Engineer (Sam DeLuca) — Tool Definitions
 *
 * Tools for: test execution, build analysis, bug reporting, CI/CD visibility.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  listCloudBuilds, getCloudBuildDetails,
  listWorkflowRuns, createIssue, type GlyphorRepo,
} from '@glyphor/integrations';

export function createQualityEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_build_logs',
      description: 'Query build outcomes for QA analysis. Filter by product, status, and limit.',
      parameters: {
        product: { type: 'string', description: 'Product: fuse or pulse', required: false, enum: ['fuse', 'pulse'] },
        status: { type: 'string', description: 'Filter by status: success, failure, all', required: false, enum: ['success', 'failure', 'all'] },
        limit: { type: 'number', description: 'Max results (default: 20)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const activity = await memory.getRecentActivity(72);
        const builds = activity.filter((a) => a.action === 'deploy' || a.action === 'analysis');
        return { success: true, data: { builds: builds.slice(0, (params.limit as number) || 20) } };
      },
    },

    {
      name: 'query_error_patterns',
      description: 'Query known error classifications and their frequency.',
      parameters: {
        product: { type: 'string', description: 'Product slug', required: false, enum: ['fuse', 'pulse'] },
        period: { type: 'string', description: 'Period: 24h, 7d, 30d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read('infra.errors.patterns');
        return { success: true, data: value ?? { note: 'No error patterns logged yet' } };
      },
    },

    {
      name: 'create_bug_report',
      description: 'File a bug report to Marcus\'s queue with severity classification.',
      parameters: {
        severity: { type: 'string', description: 'Bug severity', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', description: 'Bug title', required: true },
        description: { type: 'string', description: 'Detailed description with repro steps', required: true },
        product: { type: 'string', description: 'Affected product', required: true, enum: ['fuse', 'pulse', 'platform'] },
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
      description: 'Get test pass/fail details for a test suite.',
      parameters: {
        suite_id: { type: 'string', description: 'Test suite identifier', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(`tests.results.${(params.suite_id as string) || 'latest'}`);
        return { success: true, data: value ?? { note: 'No test results found' } };
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
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
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

    // ── GITHUB ACTIONS VISIBILITY ─────────────────────────────────

    {
      name: 'get_github_actions_runs',
      description: 'Get recent GitHub Actions workflow runs — pass/fail, branch, commit. Use alongside Cloud Build for full CI/CD visibility.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company", "fuse", or "pulse"', required: true, enum: ['company', 'fuse', 'pulse'] },
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
        repo: { type: 'string', description: 'Repo: "company", "fuse", or "pulse"', required: true, enum: ['company', 'fuse', 'pulse'] },
        severity: { type: 'string', description: 'Bug severity', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', description: 'Bug title', required: true },
        body: { type: 'string', description: 'Bug description with repro steps (markdown)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createIssue(
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
  ];
}
