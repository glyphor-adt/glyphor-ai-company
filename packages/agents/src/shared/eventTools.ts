/**
 * Shared Event Tools — emit_insight for cross-agent communication
 *
 * Available to CPO, CMO, VP-CS, and any agent that detects
 * insights other agents should know about.
 */

import type { ToolDefinition, ToolResult, EventPriority } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';

export function createEventTools(glyphorEventBus: GlyphorEventBus): ToolDefinition[] {
  return [
    {
      name: 'emit_insight',
      description: 'Emit an insight event that other agents will receive. Use when you discover something important that other departments should know about (e.g., user trends, competitive threats, anomalies).',
      parameters: {
        title: {
          type: 'string',
          description: 'Short title for the insight',
          required: true,
        },
        insight: {
          type: 'string',
          description: 'Detailed description of the insight',
          required: true,
        },
        domain: {
          type: 'string',
          description: 'Domain this insight relates to',
          required: true,
          enum: ['product', 'market', 'customer', 'financial', 'technical', 'competitive'],
        },
        priority: {
          type: 'string',
          description: 'Priority level',
          required: false,
          enum: ['critical', 'high', 'normal', 'low'],
        },
        product: {
          type: 'string',
          description: 'Related product (if applicable)',
          required: false,
          enum: ['fuse', 'pulse'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!glyphorEventBus || typeof glyphorEventBus.emit !== 'function') {
          return { success: false, error: 'Event bus is not configured' };
        }
        const event = await glyphorEventBus.emit({
          type: 'insight.detected',
          source: ctx.agentRole,
          payload: {
            title: params.title as string,
            insight: params.insight as string,
            domain: params.domain as string,
            product: params.product ?? null,
            sourceRunId: ctx.agentId,
          },
          priority: (params.priority as EventPriority) ?? 'normal',
        });
        return {
          success: true,
          data: { eventId: event.id, subscribersNotified: true },
        };
      },
    },

    {
      name: 'emit_alert',
      description: 'Emit an alert event for urgent issues that need immediate attention from other agents. Use sparingly — only for genuine problems.',
      parameters: {
        title: {
          type: 'string',
          description: 'Short alert title',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Detailed description of the alert',
          required: true,
        },
        severity: {
          type: 'string',
          description: 'Alert severity',
          required: true,
          enum: ['critical', 'high', 'normal'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!glyphorEventBus || typeof glyphorEventBus.emit !== 'function') {
          return { success: false, error: 'Event bus is not configured' };
        }
        const event = await glyphorEventBus.emit({
          type: 'alert.triggered',
          source: ctx.agentRole,
          payload: {
            title: params.title as string,
            description: params.description as string,
            sourceRunId: ctx.agentId,
          },
          priority: params.severity as EventPriority,
        });
        return {
          success: true,
          data: { eventId: event.id, subscribersNotified: true },
        };
      },
    },
  ];
}
