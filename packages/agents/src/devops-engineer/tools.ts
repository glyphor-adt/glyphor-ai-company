/**
 * DevOps Engineer (Jordan Hayes) — Tool Definitions
 * Tools for: CI/CD metrics, cache optimization, resource utilization, cold start tracking.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

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
  ];
}
