/**
 * CFO — Tool Definitions
 *
 * Tools for: cost monitoring, revenue tracking, margin analysis,
 * financial reporting, and budget alerts.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { getStripeClient } from '@glyphor/integrations';
import type Stripe from 'stripe';

export function createCFOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_financials',
      description: 'Get financial snapshots for the last N days. Returns MRR, infra costs, API costs, and margins.',
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
      name: 'get_product_metrics',
      description: 'Get current metrics for an internal engine. Returns MRR, active users, build stats.',
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
      description: 'Get all agent activity from the last N hours.',
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
          description: 'Memory namespace key (e.g., "finance.budget", "product.metrics")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'calculate_unit_economics',
      description: 'Calculate unit economics from current financial and engine data.',
      parameters: {
        product: {
          type: 'string',
          description: 'Internal engine to analyze',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const product = params.product as 'web-build' | 'pulse';
        const [metrics, financials] = await Promise.all([
          memory.getProductMetrics(product),
          memory.getFinancials(30),
        ]);
        const productFinancials = financials.filter(f => f.product === product);
        const avgMrr = productFinancials.length > 0
          ? productFinancials.reduce((s, f) => s + f.mrr, 0) / productFinancials.length
          : 0;
        const avgCost = productFinancials.length > 0
          ? productFinancials.reduce((s, f) => s + f.infraCost + f.apiCost, 0) / productFinancials.length
          : 0;
        const activeUsers = metrics?.activeUsers || 1;
        return {
          success: true,
          data: {
            product,
            avgMonthlyRevenue: avgMrr,
            avgMonthlyCost: avgCost,
            revenuePerUser: avgMrr / activeUsers,
            costPerUser: avgCost / activeUsers,
            grossMargin: avgMrr > 0 ? ((avgMrr - avgCost) / avgMrr * 100).toFixed(1) + '%' : 'N/A',
          },
        };
      },
    },

    {
      name: 'write_financial_report',
      description: 'Write a financial report to company memory and archive to GCS.',
      parameters: {
        report_type: {
          type: 'string',
          description: 'Type of report',
          required: true,
          enum: ['daily_costs', 'weekly_summary', 'monthly_pnl'],
        },
        report_markdown: {
          type: 'string',
          description: 'The report content in markdown format',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        const reportType = params.report_type as string;
        await memory.writeDocument(
          `reports/cfo/${reportType}/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          `finance.report.${reportType}.latest`,
          { date, type: reportType },
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
          enum: ['analysis', 'alert'],
        },
        summary: {
          type: 'string',
          description: 'Short summary',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'alert',
          product: 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'query_stripe_mrr',
      description: 'Query live MRR and subscription data directly from Stripe. Use for real-time financial analysis.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const stripe = getStripeClient();
          let totalMRR = 0;
          let activeCount = 0;
          let hasMore = true;
          let startingAfter: string | undefined;

          while (hasMore) {
            const params: Record<string, unknown> = { status: 'active', limit: 100 };
            if (startingAfter) params.starting_after = startingAfter;
            const subs = await stripe.subscriptions.list(params as Parameters<typeof stripe.subscriptions.list>[0]);
            for (const sub of subs.data) {
              activeCount++;
              totalMRR += sub.items.data.reduce((sum, item) => {
                const unitAmount = item.price?.unit_amount ?? 0;
                const qty = item.quantity ?? 1;
                const interval = item.price?.recurring?.interval;
                if (interval === 'year') return sum + (unitAmount * qty) / 12;
                return sum + unitAmount * qty;
              }, 0);
            }
            hasMore = subs.has_more;
            if (subs.data.length > 0) startingAfter = subs.data[subs.data.length - 1].id;
          }

          return {
            success: true,
            data: {
              mrr: totalMRR / 100,
              activeSubscriptions: activeCount,
              queriedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },

    {
      name: 'query_stripe_subscriptions',
      description: 'Get detailed subscription breakdown from Stripe including per-product revenue.',
      parameters: {
        status: {
          type: 'string',
          description: 'Subscription status filter',
          required: false,
          enum: ['active', 'canceled', 'past_due', 'trialing'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const stripe = getStripeClient();
          const status = (params.status as string) || 'active';
          const subs = await stripe.subscriptions.list({ status: status as Stripe.SubscriptionListParams['status'], limit: 100 });

          const byProduct: Record<string, { count: number; mrr: number }> = {};
          for (const sub of subs.data) {
            const product = sub.metadata?.product || 'unknown';
            if (!byProduct[product]) byProduct[product] = { count: 0, mrr: 0 };
            byProduct[product].count++;
            byProduct[product].mrr += sub.items.data.reduce(
              (sum, item) => sum + ((item.price?.unit_amount ?? 0) * (item.quantity ?? 1)) / 100,
              0,
            );
          }

          return {
            success: true,
            data: {
              total: subs.data.length,
              status,
              byProduct,
              queriedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision that requires founder approval (e.g., budget reallocation, cost alerts).',
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
          description: 'Financial context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Financial justification',
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
