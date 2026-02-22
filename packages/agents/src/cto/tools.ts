/**
 * CTO — Tool Definitions
 *
 * Tools for: platform health checks, deployment management,
 * cost optimization, and technical analysis.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { queryCloudRunMetrics, pingServices, type CloudRunMetrics } from '@glyphor/integrations';

export function createCTOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_platform_health',
      description: 'Get current platform health metrics: API latency, error rates, uptime for Cloud Run services.',
      parameters: {
        service: {
          type: 'string',
          description: 'Service to check (or "all" for all services)',
          required: false,
          enum: ['scheduler', 'dashboard', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        const services = [
          { name: 'glyphor-scheduler', url: process.env.SCHEDULER_URL },
          { name: 'glyphor-dashboard', url: process.env.DASHBOARD_URL },
        ].filter((s) => s.url) as Array<{ name: string; url: string }>;

        const serviceFilter = params.service as string | undefined;

        // Try real Cloud Monitoring metrics if GCP project is configured
        let metricsData: CloudRunMetrics[] = [];
        if (projectId) {
          try {
            const serviceIds = serviceFilter && serviceFilter !== 'all'
              ? [`glyphor-${serviceFilter}`]
              : services.map((s) => s.name);
            metricsData = await Promise.all(
              serviceIds.map((id) => queryCloudRunMetrics(projectId, id, 1)),
            );
          } catch (err) {
            console.warn('[CTO] Cloud Monitoring query failed, falling back to health pings:', (err as Error).message);
          }
        }

        // Always run health pings as baseline
        const pingTargets = serviceFilter && serviceFilter !== 'all'
          ? services.filter((s) => s.name.includes(serviceFilter))
          : services;
        const healthChecks = pingTargets.length > 0
          ? await pingServices(pingTargets.map((s) => ({ url: `${s.url}/health`, name: s.name })))
          : [];

        // Also get recent activity for deploy/alert context
        const activity = await memory.getRecentActivity(6);
        const deployEvents = activity.filter(a => a.action === 'deploy');
        const alertEvents = activity.filter(a => a.action === 'alert');

        const overallStatus = healthChecks.some((h) => h.status === 'down')
          ? 'degraded'
          : alertEvents.length > 0
            ? 'degraded'
            : 'healthy';

        return {
          success: true,
          data: {
            status: overallStatus,
            cloudRunMetrics: metricsData.length > 0 ? metricsData : undefined,
            healthChecks: healthChecks.length > 0 ? healthChecks : undefined,
            recentDeploys: deployEvents,
            recentAlerts: alertEvents,
            checkedAt: new Date().toISOString(),
          },
        };
      },
    },

    {
      name: 'get_cloud_run_metrics',
      description: 'Get detailed Cloud Run metrics (request count, latency, error rate, instance count) for a specific service.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service name (e.g., "glyphor-scheduler")',
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
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }
        try {
          const metrics = await queryCloudRunMetrics(
            projectId,
            params.service as string,
            (params.hours as number) || 1,
          );
          return { success: true, data: metrics };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_infrastructure_costs',
      description: 'Get infrastructure cost breakdown (Cloud Run, Supabase, API tokens, storage).',
      parameters: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const days = (params.days as number) || 7;
        const financials = await memory.getFinancials(days);
        const totalInfra = financials.reduce((s, f) => s + f.infraCost, 0);
        const totalApi = financials.reduce((s, f) => s + f.apiCost, 0);
        return {
          success: true,
          data: {
            period: `${days} days`,
            totalInfraCost: totalInfra,
            totalApiCost: totalApi,
            dailySnapshots: financials,
          },
        };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get all agent and system activity from the last N hours.',
      parameters: {
        hours: {
          type: 'number',
          description: 'Number of hours to look back (default: 24)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const hours = (params.hours as number) || 24;
        const activity = await memory.getRecentActivity(hours);
        return { success: true, data: activity };
      },
    },

    {
      name: 'read_company_memory',
      description: 'Read a value from company shared memory by key.',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory namespace key to read (e.g., "infra.cloud-run", "product.fuse.metrics")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'write_health_report',
      description: 'Write a health check report to company memory and archive to GCS.',
      parameters: {
        report_markdown: {
          type: 'string',
          description: 'The health report content in markdown format',
          required: true,
        },
        status: {
          type: 'string',
          description: 'Overall platform status',
          required: true,
          enum: ['healthy', 'degraded', 'incident'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `reports/cto/health/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          'infra.health.latest',
          { status: params.status, date, report: params.report_markdown },
          ctx.agentId,
        );
        return { success: true, data: { archived: true }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'log_activity',
      description: 'Log an activity to the company activity feed.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type',
          required: true,
          enum: ['analysis', 'deploy', 'alert'],
        },
        summary: {
          type: 'string',
          description: 'Short summary of the activity',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Related product',
          required: false,
          enum: ['fuse', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'deploy' | 'alert',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision that requires founder approval (e.g., costly model switch, production deploy).',
      parameters: {
        tier: {
          type: 'string',
          description: 'Decision tier',
          required: true,
          enum: ['yellow', 'red'],
        },
        title: {
          type: 'string',
          description: 'Short decision title',
          required: true,
        },
        summary: {
          type: 'string',
          description: 'Decision context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Technical justification',
          required: true,
        },
        assigned_to: {
          type: 'array',
          description: 'Founders to assign',
          required: true,
          items: { type: 'string', description: 'Founder name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await memory.createDecision({
          tier: params.tier as 'yellow' | 'red',
          status: 'pending',
          title: params.title as string,
          summary: params.summary as string,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: params.assigned_to as string[],
        });
        return { success: true, data: { decisionId: id }, memoryKeysWritten: 1 };
      },
    },
  ];
}
