/**
 * CMO — Tool Definitions
 *
 * Tools for: content generation, social media planning,
 * SEO analysis, and brand content management.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { createAllPulseTools } from '../shared/pulseTools.js';
import { createFacebookTools } from '../shared/facebookTools.js';
import { createLinkedInTools } from '../shared/linkedinTools.js';

export function createCMOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_product_metrics',
      description: 'Get current internal engine metrics to inform content with real data points. Do not reference engine names in customer-facing content.',
      parameters: {
        product: {
          type: 'string',
          description: 'Internal engine slug',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'web-build' | 'pulse');
        return { success: true, data: metrics };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get recent company activity to find content-worthy events.',
      parameters: {
        hours: {
          type: 'number',
          description: 'Number of hours to look back (default: 168 for a week)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const hours = (params.hours as number) || 168;
        const activity = await memory.getRecentActivity(hours);
        return { success: true, data: activity };
      },
    },

    {
      name: 'read_company_memory',
      description: 'Read from company memory for brand guidelines, prior content, etc.',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory key (e.g., "brand.voice", "content.calendar", "marketing.strategy")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'write_content',
      description: 'Write generated content (blog posts, social posts, case studies) to GCS.',
      parameters: {
        content_type: {
          type: 'string',
          description: 'Type of content',
          required: true,
          enum: ['blog_post', 'social_post', 'case_study', 'content_calendar', 'seo_report'],
        },
        title: {
          type: 'string',
          description: 'Content title or identifier',
          required: true,
        },
        content_markdown: {
          type: 'string',
          description: 'The content in markdown format',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Target platform for social posts',
          required: false,
          enum: ['twitter', 'linkedin', 'product_hunt', 'blog'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        const contentType = params.content_type as string;
        const title = (params.title as string).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        await memory.writeDocument(
          `content/cmo/${contentType}/${date}-${title}.md`,
          params.content_markdown as string,
        );
        await memory.write(
          `content.${contentType}.latest`,
          { date, title: params.title, type: contentType, platform: params.platform },
          ctx.agentId,
        );
        return { success: true, data: { archived: true, path: `content/cmo/${contentType}/${date}-${title}.md` }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'write_company_memory',
      description: 'Write a value to company shared memory (e.g., update content calendar).',
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
          enum: ['content', 'analysis'],
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
          enum: ['company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'content' | 'analysis',
          product: (params.product as 'web-build' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision for founder approval (e.g., content strategy shifts, brand changes).',
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
          description: 'Justification',
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

    // ── Pulse Creative Studio tools (MCP) ──
    ...createAllPulseTools(memory),

    // ── Facebook / Meta Page tools ──
    ...createFacebookTools(),

    // ── LinkedIn Organization tools ──
    ...createLinkedInTools(),
  ];
}
