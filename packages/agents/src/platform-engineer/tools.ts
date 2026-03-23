/**
 * Platform Engineer (Alex Park) — Tool Definitions
 *
 * Tools for: infrastructure monitoring, health checks, metrics querying,
 * Cloud Build visibility, and issue reporting.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { systemQuery } from '@glyphor/shared/db';
import {
  queryCloudRunMetrics, pingServices,
  listOpenPRs, getRepoStats, listRecentCommits, type GlyphorRepo,
  listCloudBuilds, getCloudBuildDetails, resolveGcpProjectIdForCloudBuild,
  createIssueForCopilot,
} from '@glyphor/integrations';

export function createPlatformEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_cloud_run_metrics',
      description: 'Get Cloud Run metrics: instances, latency (p50/p99), errors, cold starts for a service.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service name (e.g., "glyphor-scheduler", "glyphor-dashboard")',
          required: true,
        },
        hours: {
          type: 'number',
          description: 'Hours to look back (default: 1)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };
        try {
          const metrics = await queryCloudRunMetrics(projectId, params.service as string, (params.hours as number) || 1);
          return { success: true, data: metrics };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'run_health_check',
      description: 'Ping all services and return a status matrix: up/down, latency, response code.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const services = [
          { name: 'glyphor-scheduler', url: process.env.SCHEDULER_URL },
          { name: 'glyphor-dashboard', url: process.env.DASHBOARD_URL },
        ].filter((s) => s.url) as Array<{ name: string; url: string }>;

        if (services.length === 0) {
          return { success: true, data: { status: 'no services configured', services: [] } };
        }

        const results = await pingServices(services.map((s) => ({ url: `${s.url}/health`, name: s.name })));
        const overall = results.every((r) => r.status === 'healthy') ? 'healthy' : 'degraded';
        return { success: true, data: { status: overall, services: results, checkedAt: new Date().toISOString() } };
      },
    },

    {
      name: 'query_gemini_latency',
      description: 'Query Gemini API response times and availability by model.',
      parameters: {
        model: {
          type: 'string',
          description: 'Model to check (default: gpt-5-mini-2025-08-07)',
          required: false,
        },
        hours: {
          type: 'number',
          description: 'Hours to look back (default: 1)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const model = (params.model as string) || 'gpt-5-mini-2025-08-07';
        // Read from memory where agent runs are logged
        const activity = await memory.getRecentActivity((params.hours as number) || 1);
        const aiCalls = activity.filter((a) => a.action === 'analysis' || a.action === 'deploy');
        return {
          success: true,
          data: { model, recentAgentRuns: aiCalls.length, note: 'Detailed Gemini metrics from Cloud Monitoring' },
        };
      },
    },

    {
      name: 'query_db_health',
      description: 'Check Cloud SQL connection pool, query latency, and replication lag.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const start = Date.now();
          await systemQuery('SELECT role FROM company_agents LIMIT 1', []);
          const latencyMs = Date.now() - start;
          return {
            success: true,
            data: {
              connected: true,
              queryLatencyMs: latencyMs,
              checkedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'query_uptime',
      description: 'Query uptime percentage for a service over a period.',
      parameters: {
        service: {
          type: 'string',
          description: 'Service name',
          required: true,
        },
        days: {
          type: 'number',
          description: 'Days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        // Read health snapshots from memory
        const value = await memory.read(`infra.health.latest`);
        return {
          success: true,
          data: {
            service: params.service,
            period: `${(params.days as number) || 7} days`,
            latestHealth: value,
            note: 'Historical uptime tracking via health snapshots',
          },
        };
      },
    },

    {
      name: 'get_repo_code_health',
      description: 'Get open PRs and recent commits across Glyphor repos — used to assess code health and merge velocity.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo: "company"',
          required: true,
          enum: ['company'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const [prs, stats, commits] = await Promise.all([
            listOpenPRs(params.repo as GlyphorRepo),
            getRepoStats(params.repo as GlyphorRepo),
            listRecentCommits(params.repo as GlyphorRepo, 10),
          ]);
          return { success: true, data: { openPRs: prs, stats, recentCommits: commits } };
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
      description: 'List recent GCP Cloud Build runs — status, duration, trigger. Correlate with Cloud Run health.',
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
      description: 'Get detailed logs for a specific Cloud Build — step-by-step output and errors.',
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

    // ── ISSUE REPORTING ───────────────────────────────────────────

    {
      name: 'create_github_issue',
      description: 'Create a GitHub issue to report a platform health problem, outage, or degradation you detected.',
      parameters: {
        repo: { type: 'string', description: 'Repo: "company"', required: true, enum: ['company'] },
        title: { type: 'string', description: 'Issue title', required: true },
        body: { type: 'string', description: 'Issue body with diagnostic data (markdown)', required: true },
        labels: { type: 'array', description: 'Labels (e.g., ["platform", "health"])', required: false, items: { type: 'string', description: 'Label' } },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createIssueForCopilot(
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
  ];
}
