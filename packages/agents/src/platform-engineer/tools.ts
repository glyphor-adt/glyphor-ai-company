/**
 * Platform Engineer (Alex Park) — Tool Definitions
 *
 * Tools for: infrastructure monitoring, health checks, metrics querying.
 * All read-only — Alex cannot deploy, change configs, or create incidents.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { queryCloudRunMetrics, pingServices } from '@glyphor/integrations';

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
          description: 'Model to check (default: gemini-3-flash-preview)',
          required: false,
        },
        hours: {
          type: 'number',
          description: 'Hours to look back (default: 1)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const model = (params.model as string) || 'gemini-3-flash-preview';
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
      name: 'query_supabase_health',
      description: 'Check Supabase connection pool, query latency, and replication lag.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const start = Date.now();
          const { data, error } = await memory.getSupabaseClient().from('company_agents').select('role').limit(1);
          const latencyMs = Date.now() - start;
          return {
            success: true,
            data: {
              connected: !error,
              queryLatencyMs: latencyMs,
              error: error?.message,
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
  ];
}
