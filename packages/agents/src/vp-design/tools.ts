/**
 * VP Design & Frontend — Tool Definitions
 *
 * Tools for: design quality auditing, component library management,
 * design token governance, and output quality assessment.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createVPDesignTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_design_quality_summary',
      description: 'Get a summary of recent Fuse output quality: grade distribution, dimension scores, and trends.',
      parameters: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const days = (params.days as number) || 7;
        const data = await memory.read('design.quality.latest');
        const trends = await memory.read('design.quality.trends');
        return {
          success: true,
          data: { period: `${days} days`, qualitySummary: data, trends },
        };
      },
    },

    {
      name: 'get_design_tokens',
      description: 'Get current design token values: typography scale, color palette, spacing scale, border/shadow system.',
      parameters: {
        category: {
          type: 'string',
          description: 'Token category to retrieve (or "all")',
          required: false,
          enum: ['typography', 'color', 'spacing', 'borders', 'shadows', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const category = (params.category as string) || 'all';
        const tokens = await memory.read(`design.tokens.${category === 'all' ? 'current' : category}`);
        return { success: true, data: tokens ?? { note: `No tokens stored for ${category} yet` } };
      },
    },

    {
      name: 'get_component_library',
      description: 'Get the component library: all components, their variants, and usage frequency.',
      parameters: {
        component: {
          type: 'string',
          description: 'Specific component name (or omit for full library)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const key = params.component
          ? `design.components.${params.component as string}`
          : 'design.components.registry';
        const data = await memory.read(key);
        return { success: true, data: data ?? { note: 'No component data stored yet' } };
      },
    },

    {
      name: 'get_template_registry',
      description: 'Get all templates with usage data, quality grades, and completion rates.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const data = await memory.read('design.templates.registry');
        return { success: true, data: data ?? { note: 'No template registry stored yet' } };
      },
    },

    {
      name: 'write_design_audit',
      description: 'Save a design quality audit report with grades and recommendations.',
      parameters: {
        report_markdown: {
          type: 'string',
          description: 'The audit report content in markdown format',
          required: true,
        },
        grade_distribution: {
          type: 'object',
          description: 'Grade counts: { "A+": n, "A": n, "B": n, "C": n, "F": n }',
          required: true,
        },
        a_plus_a_rate: {
          type: 'number',
          description: 'Percentage of builds at A+ or A grade',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `reports/design/audit/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          'design.quality.latest',
          {
            date,
            gradeDistribution: params.grade_distribution,
            aPlusARate: params.a_plus_a_rate,
            report: params.report_markdown,
          },
          ctx.agentId,
        );
        return { success: true, data: { archived: true }, memoryKeysWritten: 1 };
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
          description: 'Memory namespace key to read (e.g., "design.tokens.current", "design.quality.trends")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'log_activity',
      description: 'Log a design activity to the company activity feed.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type',
          required: true,
          enum: ['analysis', 'alert', 'content'],
        },
        summary: {
          type: 'string',
          description: 'Short summary of the activity',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'alert' | 'content',
          product: 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision that requires founder approval (e.g., design token change, component library update).',
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
          description: 'Design justification with evidence',
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
