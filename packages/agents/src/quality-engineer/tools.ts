/**
 * Quality Engineer (Sam DeLuca) — Tool Definitions
 *
 * Tools for: test execution, build analysis, bug reporting, CI/CD visibility.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  listCloudBuilds, getCloudBuildDetails,
  listWorkflowRuns, createIssue, type GlyphorRepo,
} from '@glyphor/integrations';

export function createQualityEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_build_logs',
      description: 'Query build outcomes for QA analysis. Filter by product, status, and limit.',
      parameters: {
        product: { type: 'string', description: 'Product: fuse or pulse', required: false, enum: ['fuse', 'pulse'] },
        status: { type: 'string', description: 'Filter by status: success, failure, all', required: false, enum: ['success', 'failure', 'all'] },
        limit: { type: 'number', description: 'Max results (default: 20)', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const activity = await memory.getRecentActivity(72);
        const builds = activity.filter((a) => a.action === 'deploy' || a.action === 'analysis');
        return { success: true, data: { builds: builds.slice(0, (params.limit as number) || 20) } };
      },
    },

    {
      name: 'query_error_patterns',
      description: 'Query known error classifications and their frequency.',
      parameters: {
        product: { type: 'string', description: 'Product slug', required: false, enum: ['fuse', 'pulse'] },
        period: { type: 'string', description: 'Period: 24h, 7d, 30d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read('infra.errors.patterns');
        return { success: true, data: value ?? { note: 'No error patterns logged yet' } };
      },
    },

    {
      name: 'create_bug_report',
      description: 'File a bug report to Marcus\'s queue with severity classification.',
      parameters: {
        severity: { type: 'string', description: 'Bug severity', required: true, enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', description: 'Bug title', required: true },
        description: { type: 'string', description: 'Detailed description with repro steps', required: true },
        product: { type: 'string', description: 'Affected product', required: true, enum: ['fuse', 'pulse', 'platform'] },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString();
        await memory.write(`bugs.${params.severity}.${date}`, {
          severity: params.severity,
          title: params.title,
          description: params.description,
          product: params.product,
          reporter: ctx.agentRole,
          createdAt: date,
        }, ctx.agentId);
        return { success: true, data: { filed: true, severity: params.severity }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'query_test_results',
      description: 'Get test pass/fail details for a test suite.',
      parameters: {
        suite_id: { type: 'string', description: 'Test suite identifier', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(`tests.results.${(params.suite_id as string) || 'latest'}`);
        return { success: true, data: value ?? { note: 'No test results found' } };
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
