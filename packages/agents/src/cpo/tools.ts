/**
 * CPO — Tool Definitions
 *
 * Tools for: usage analysis, competitive intelligence,
 * feature prioritization, and roadmap management.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createCPOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_product_metrics',
      description: 'Get current metrics for an internal engine. Fuse and Pulse are internal engine identifiers, not external products. Returns MRR, active users, build stats.',
      parameters: {
        product: {
          type: 'string',
          description: 'Internal engine slug',
          required: true,
          enum: ['fuse', 'pulse'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'fuse' | 'pulse');
        if (!metrics) {
          return { success: true, data: { message: `No product data found for '${params.product}'. The product may not be tracked yet. This is NOT an incident — do not fabricate metrics or crises.` } };
        }
        return { success: true, data: metrics };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get all agent activity from the last N hours. Useful for seeing what other agents have done.',
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
          description: 'Memory key (e.g., "product.fuse.roadmap", "product.pulse.features")',
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
      description: 'Get financial data for product revenue and cost analysis.',
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
        return { success: true, data: financials };
      },
    },

    {
      name: 'write_product_analysis',
      description: 'Write a product analysis report (usage, competitive, roadmap) to GCS.',
      parameters: {
        analysis_type: {
          type: 'string',
          description: 'Type of analysis',
          required: true,
          enum: ['usage', 'competitive', 'roadmap', 'feature_prioritization'],
        },
        report_markdown: {
          type: 'string',
          description: 'The analysis content in markdown',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Internal engine this analysis covers',
          required: false,
          enum: ['fuse', 'pulse', 'both'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        const analysisType = params.analysis_type as string;
        await memory.writeDocument(
          `reports/cpo/${analysisType}/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          `product.analysis.${analysisType}.latest`,
          { date, type: analysisType, product: params.product ?? 'both' },
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
          enum: ['analysis', 'decision'],
        },
        summary: {
          type: 'string',
          description: 'Short summary',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Related engine or company-wide',
          required: false,
          enum: ['fuse', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'decision',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision for founder approval (e.g., roadmap priority changes, new product proposals).',
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
          description: 'Product context and recommendation',
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
