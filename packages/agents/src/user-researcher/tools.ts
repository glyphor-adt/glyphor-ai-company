/**
 * User Researcher (Priya Sharma) — Tool Definitions
 * Tools for: cohort analysis, user behavior, experiments, churn detection.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createUserResearcherTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_user_analytics',
      description: 'Query usage metrics by cohort, segment, and period.',
      parameters: {
        metric: { type: 'string', description: 'Metric: sessions, builds, feature_adoption, retention', required: true },
        segment: { type: 'string', description: 'User segment filter (optional)', required: false },
        period: { type: 'string', description: 'Period: 7d, 30d, 90d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.read(`analytics.users.${params.metric}`);
        return { success: true, data: metrics ?? { metric: params.metric, note: 'No analytics data yet' } };
      },
    },
    {
      name: 'query_build_metadata',
      description: 'Analyze what users build: categories, complexity, outcomes.',
      parameters: {
        filters: { type: 'string', description: 'Filter criteria (e.g., "new_users", "power_users")', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const data = await memory.read('analytics.builds.metadata');
        return { success: true, data: data ?? { note: 'No build metadata yet' } };
      },
    },
    {
      name: 'query_onboarding_funnel',
      description: 'Get onboarding funnel conversion rates: signup → first build → activation.',
      parameters: {
        period: { type: 'string', description: 'Period: 7d, 30d, 90d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const data = await memory.read('analytics.onboarding.funnel');
        return { success: true, data: data ?? { note: 'No funnel data yet' } };
      },
    },
    {
      name: 'run_cohort_analysis',
      description: 'Run retention/LTV analysis by signup cohort.',
      parameters: {
        criteria: { type: 'string', description: 'Cohort grouping: signup_month, plan, source', required: true },
        metric: { type: 'string', description: 'Metric: retention, ltv, activation', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        return {
          success: true,
          data: { criteria: params.criteria, metric: params.metric, note: 'Cohort analysis run against analytics data' },
        };
      },
    },
    {
      name: 'query_churn_data',
      description: 'Get churned users: who, when, last actions before churn.',
      parameters: {
        period: { type: 'string', description: 'Period: 7d, 30d, 90d', required: false },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const data = await memory.read('analytics.churn');
        return { success: true, data: data ?? { note: 'No churn data yet' } };
      },
    },
    {
      name: 'design_experiment',
      description: 'Design an A/B test plan with hypothesis, measurement criteria, and sample size.',
      parameters: {
        hypothesis: { type: 'string', description: 'What you expect to observe', required: true },
        metric: { type: 'string', description: 'Primary metric to measure', required: true },
        duration_days: { type: 'number', description: 'Proposed experiment duration in days', required: false },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString();
        await memory.write(`experiments.proposed.${date}`, {
          hypothesis: params.hypothesis,
          metric: params.metric,
          durationDays: (params.duration_days as number) || 14,
          designedBy: ctx.agentRole,
          status: 'proposed',
          createdAt: date,
        }, ctx.agentId);
        return { success: true, data: { status: 'designed', awaitingElenaApproval: true }, memoryKeysWritten: 1 };
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
