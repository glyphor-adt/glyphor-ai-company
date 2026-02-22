/**
 * VP Customer Success — Tool Definitions
 *
 * Tools for: health scoring, churn detection, nurture outreach,
 * segment analysis, and cross-product recommendations.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createVPCSTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_product_metrics',
      description: 'Get current metrics for a product. Returns active users, engagement, build stats.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product slug',
          required: true,
          enum: ['fuse', 'pulse'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'fuse' | 'pulse');
        return { success: true, data: metrics };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get recent activity across all agents.',
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
      description: 'Read from company shared memory.',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory key (e.g., "customers.health_scores", "customers.segments")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'get_financials',
      description: 'Get financial data to understand revenue per segment.',
      parameters: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 30)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const days = (params.days as number) || 30;
        const financials = await memory.getFinancials(days);
        return { success: true, data: financials };
      },
    },

    {
      name: 'write_health_report',
      description: 'Write a customer health scoring report to GCS.',
      parameters: {
        report_markdown: {
          type: 'string',
          description: 'The health scoring report in markdown format',
          required: true,
        },
        segments: {
          type: 'object',
          description: 'Segment counts: { power: N, regular: N, casual: N, dormant: N }',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `reports/vpcs/health-scoring/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          'customers.health_scores.latest',
          { date, segments: params.segments },
          ctx.agentId,
        );
        return { success: true, data: { archived: true }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'write_company_memory',
      description: 'Write a value to company shared memory (e.g., update segment data).',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory key to write',
          required: true,
        },
        value: {
          type: 'object',
          description: 'Value to store',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.write(params.key as string, params.value, ctx.agentId);
        return { success: true, memoryKeysWritten: 1 };
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
          enum: ['analysis', 'outreach', 'alert'],
        },
        summary: {
          type: 'string',
          description: 'Short summary',
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
          action: params.action as 'analysis' | 'outreach' | 'alert',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision for founder approval (e.g., enterprise upsell outreach).',
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
          description: 'Context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Data-driven justification',
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
