/**
 * DevOps Engineer (Jordan Hayes) — Tool Definitions
 * Tools for: CI/CD metrics, cache optimization, resource utilization, cold start tracking.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { listWorkflowRuns, listRecentCommits, commentOnPR, type GlyphorRepo, listDeployments, type VercelTeamKey } from '@glyphor/integrations';

export function createDevOpsEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_cache_metrics',
      description: 'Get cache hit rate, miss rate, and eviction rate.',
      parameters: {
        hours: { type: 'number', description: 'Hours to look back (default: 6)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read('infra.cache.metrics');
        return { success: true, data: value ?? { note: 'No cache metrics logged yet' } };
      },
    },
    {
      name: 'query_pipeline_metrics',
      description: 'Get CI/CD build times, deploy times, and rollout duration.',
      parameters: {
        period: { type: 'string', description: 'Period: 24h, 7d, 30d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read('infra.pipeline.metrics');
        return { success: true, data: value ?? { note: 'No pipeline metrics logged yet' } };
      },
    },
    {
      name: 'query_resource_utilization',
      description: 'Get CPU, memory, and instance count vs actual usage for a service.',
      parameters: {
        service: { type: 'string', description: 'Service name', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(`infra.utilization.${params.service}`);
        return { success: true, data: value ?? { service: params.service, note: 'No utilization data yet' } };
      },
    },
    {
      name: 'query_cold_starts',
      description: 'Get cold start frequency and duration for a service.',
      parameters: {
        service: { type: 'string', description: 'Service name', required: true },
        hours: { type: 'number', description: 'Hours to look back (default: 6)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(`infra.coldstarts.${params.service}`);
        return { success: true, data: value ?? { service: params.service, note: 'No cold start data yet' } };
      },
    },
    {
      name: 'identify_unused_resources',
      description: 'Find zero-usage services, channels, or storage that could be cleaned up.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const value = await memory.read('infra.unused_resources');
        return { success: true, data: value ?? { note: 'No unused resource audit yet' } };
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
          description: 'Repo to check: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
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
          description: 'Repo to check: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
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
      name: 'query_vercel_builds',
      description: 'Get recent Vercel deployments — shows build status, duration, and error rate. "fuse" = Fuse product, "fuse-projects" = user deployments.',
      parameters: {
        project: {
          type: 'string',
          description: 'Scope: "fuse" (product) or "fuse-projects" (user deployments)',
          required: true,
          enum: ['fuse', 'fuse-projects'],
        },
        limit: {
          type: 'number',
          description: 'Number of recent deployments (default: 15)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const deployments = await listDeployments(params.project as VercelTeamKey, (params.limit as number) || 15);
          const errored = deployments.filter((d) => d.state === 'ERROR').length;
          const ready = deployments.filter((d) => d.state === 'READY').length;
          const building = deployments.filter((d) => d.state === 'BUILDING').length;

          // Calculate avg build duration for completed builds
          let avgBuildMs: number | null = null;
          const completed = deployments.filter((d) => d.readyAt && d.buildingAt);
          if (completed.length > 0) {
            const totalMs = completed.reduce((s, d) => s + (d.readyAt! - d.buildingAt!), 0);
            avgBuildMs = Math.round(totalMs / completed.length);
          }

          return {
            success: true,
            data: {
              total: deployments.length,
              ready,
              errored,
              building,
              successRate: deployments.length > 0 ? Math.round((ready / deployments.length) * 100) : null,
              avgBuildDurationMs: avgBuildMs,
              deployments,
            },
          };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('VERCEL_TOKEN')) return { success: false, error: 'NO_DATA: VERCEL_TOKEN not configured yet.' };
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
          description: 'Repo: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
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
  ];
}
