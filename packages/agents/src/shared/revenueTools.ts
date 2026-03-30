/**
 * Revenue Tools — Shared tools for revenue analytics & financial intelligence
 *
 * Tools:
 *   get_mrr_breakdown      — Detailed MRR breakdown by plan, product, or segment
 *   get_subscription_details — List individual Stripe subscriptions
 *   get_churn_analysis     — Analyze churn patterns and revenue impact
 *   get_revenue_forecast   — Generate revenue forecast with scenario modeling
 *   get_stripe_invoices    — Pull recent invoices from Stripe
 *   get_customer_ltv       — Calculate customer lifetime value by segment
 */

import type { PredictionJournalRecord, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

function addMonthsIso(base: Date, monthsAhead: number): string {
  const target = new Date(base);
  target.setUTCMonth(target.getUTCMonth() + monthsAhead);
  return target.toISOString();
}

async function stripeFetch(path: string): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return await res.json() as Record<string, unknown>;
}

export function createRevenueTools(): ToolDefinition[] {
  return [
    /* ── get_mrr_breakdown ─────────────────── */
    {
      name: 'get_mrr_breakdown',
      description:
        'Detailed MRR breakdown beyond company_pulse. Returns MRR categorized by plan, product, ' +
        'or segment with new, expansion, contraction, and churned MRR components.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for the MRR breakdown.',
          enum: ['7d', '30d', '90d'],
          required: true,
        },
        breakdown_by: {
          type: 'string',
          description: 'Dimension to break MRR down by.',
          enum: ['plan', 'product', 'segment'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateRange = params.date_range as string;
        const breakdownBy = params.breakdown_by as string;
        const intervalStr = dateRange.replace(/(\d+)d$/, '$1 days');

        try {
          // Map breakdown_by enum to actual stripe_data columns
          const columnMap: Record<string, string> = { plan: 'plan', product: 'product', segment: 'product' };
          const dbColumn = columnMap[breakdownBy] ?? 'product';

          const rows = await systemQuery(
            `SELECT ${dbColumn} AS category,
                    SUM(amount_usd) AS total_mrr,
                    SUM(CASE WHEN record_type = 'new' THEN amount_usd ELSE 0 END) AS new_mrr,
                    SUM(CASE WHEN record_type = 'expansion' THEN amount_usd ELSE 0 END) AS expansion_mrr,
                    SUM(CASE WHEN record_type = 'contraction' THEN amount_usd ELSE 0 END) AS contraction_mrr,
                    SUM(CASE WHEN record_type = 'churned' THEN amount_usd ELSE 0 END) AS churned_mrr
             FROM stripe_data
             WHERE recorded_at >= NOW() - CAST($1 AS INTERVAL)
             GROUP BY ${dbColumn}
             ORDER BY total_mrr DESC`,
            [intervalStr],
          );

          return {
            success: true,
            data: {
              date_range: dateRange,
              breakdown_by: breakdownBy,
              categories: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `MRR breakdown failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_subscription_details ──────────── */
    {
      name: 'get_subscription_details',
      description:
        'List individual Stripe subscriptions. Filter by status and plan to inspect ' +
        'specific customer subscriptions with billing details.',
      parameters: {
        status: {
          type: 'string',
          description: 'Subscription status filter.',
          enum: ['active', 'past_due', 'canceled', 'all'],
          required: true,
        },
        plan: {
          type: 'string',
          description: 'Filter by plan name or price ID.',
        },
        limit: {
          type: 'number',
          description: 'Max number of subscriptions to return (default: 20).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const status = params.status as string;
        const plan = params.plan as string | undefined;
        const limit = (params.limit as number) || 20;

        try {
          let path = `/subscriptions?limit=${limit}`;
          if (status !== 'all') path += `&status=${status}`;
          if (plan) path += `&price=${encodeURIComponent(plan)}`;

          const result = await stripeFetch(path);
          const subscriptions = (result.data as Record<string, unknown>[]) || [];

          return {
            success: true,
            data: {
              count: subscriptions.length,
              subscriptions: subscriptions.map((sub) => ({
                customer: sub.customer,
                plan: (sub.plan as Record<string, unknown>)?.id ?? null,
                amount: sub.quantity,
                start_date: sub.start_date,
                status: sub.status,
                next_billing: sub.current_period_end,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Stripe subscriptions failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_churn_analysis ────────────────── */
    {
      name: 'get_churn_analysis',
      description:
        'Analyze churn patterns over a date range. Returns churn rate, churned customer count, ' +
        'churn broken down by plan, and total revenue impact.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for churn analysis.',
          enum: ['30d', '90d', '180d'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateRange = params.date_range as string;
        const intervalStr = dateRange.replace(/(\d+)d$/, '$1 days');

        try {
          const rows = await systemQuery(
            `SELECT
               COUNT(*) FILTER (WHERE record_type = 'churned') AS churned_customers,
               COUNT(*) FILTER (WHERE record_type IN ('active','churned')) AS total_customers,
               ROUND(
                 COUNT(*) FILTER (WHERE record_type = 'churned')::numeric /
                 NULLIF(COUNT(*) FILTER (WHERE record_type IN ('active','churned')), 0) * 100, 2
               ) AS churn_rate,
               COALESCE(SUM(amount_usd) FILTER (WHERE record_type = 'churned'), 0) AS revenue_impact
             FROM stripe_data
             WHERE recorded_at >= NOW() - CAST($1 AS INTERVAL)`,
            [intervalStr],
          );

          const churnByPlan = await systemQuery(
            `SELECT plan,
                    COUNT(*) AS churned_count,
                    COALESCE(SUM(amount_usd), 0) AS revenue_lost
             FROM stripe_data
             WHERE record_type = 'churned'
               AND recorded_at >= NOW() - CAST($1 AS INTERVAL)
             GROUP BY plan
             ORDER BY revenue_lost DESC`,
            [intervalStr],
          );

          const summary = rows[0] || {};

          return {
            success: true,
            data: {
              date_range: dateRange,
              churn_rate: summary.churn_rate,
              churned_customers: summary.churned_customers,
              revenue_impact: summary.revenue_impact,
              churn_by_plan: churnByPlan,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Churn analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_revenue_forecast ──────────────── */
    {
      name: 'get_revenue_forecast',
      description:
        'Generate revenue forecast based on current MRR, growth, and churn rates. ' +
        'Supports conservative (90% of base growth), base, and optimistic (130% of base growth) scenarios.',
      parameters: {
        months_ahead: {
          type: 'number',
          description: 'Number of months to forecast.',
          required: true,
        },
        scenario: {
          type: 'string',
          description: 'Forecast scenario.',
          enum: ['conservative', 'base', 'optimistic'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const monthsAhead = params.months_ahead as number;
        const scenario = params.scenario as string;

        try {
          const rows = await systemQuery(
            `SELECT
               COALESCE(SUM(amount_usd), 0) AS current_mrr,
               COALESCE(
                 (SUM(amount_usd) FILTER (WHERE record_type = 'new') +
                  SUM(amount_usd) FILTER (WHERE record_type = 'expansion')) /
                 NULLIF(SUM(amount_usd), 0), 0
               ) AS avg_growth_rate,
               COALESCE(
                 ABS(SUM(amount_usd) FILTER (WHERE record_type = 'churned')) /
                 NULLIF(SUM(amount_usd), 0), 0
               ) AS avg_churn_rate
             FROM stripe_data
             WHERE recorded_at >= NOW() - INTERVAL '90 days'`,
            [],
          );

          const metrics = rows[0] || { current_mrr: 0, avg_growth_rate: 0, avg_churn_rate: 0 };
          const currentMrr = Number(metrics.current_mrr);
          const baseGrowth = Number(metrics.avg_growth_rate);
          const churnRate = Number(metrics.avg_churn_rate);

          const scenarioMultiplier =
            scenario === 'conservative' ? 0.9 : scenario === 'optimistic' ? 1.3 : 1.0;
          const adjustedGrowth = baseGrowth * scenarioMultiplier;

          const projections: { month: number; projected_mrr: number }[] = [];
          let mrr = currentMrr;
          for (let i = 1; i <= monthsAhead; i++) {
            mrr = mrr * (1 + adjustedGrowth - churnRate);
            projections.push({ month: i, projected_mrr: Math.round(mrr * 100) / 100 });
          }

          const baseDate = new Date();
          const predictions: PredictionJournalRecord[] = projections.map((projection) => ({
            prediction_type: 'revenue_forecast_mrr',
            predicted_value: {
              projected_mrr: projection.projected_mrr,
              month_index: projection.month,
              scenario,
              growth_rate: adjustedGrowth,
              churn_rate: churnRate,
            },
            target_date: addMonthsIso(baseDate, projection.month),
            resolution_source: 'stripe_mrr_30d',
          }));

          return {
            success: true,
            data: {
              scenario,
              current_mrr: currentMrr,
              growth_rate: adjustedGrowth,
              churn_rate: churnRate,
              projections,
              predictions,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Revenue forecast failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_stripe_invoices ───────────────── */
    {
      name: 'get_stripe_invoices',
      description:
        'Pull recent invoices from Stripe. Filter by date range and payment status ' +
        'to review billing activity.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for invoices.',
          enum: ['7d', '30d', '90d'],
          required: true,
        },
        status: {
          type: 'string',
          description: 'Invoice status filter.',
          enum: ['paid', 'open', 'draft', 'void'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateRange = params.date_range as string;
        const status = params.status as string;

        try {
          const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
          const days = daysMap[dateRange] || 30;
          const since = Math.floor(Date.now() / 1000) - days * 86400;
          const limit = days <= 7 ? 25 : days <= 30 ? 50 : 100;

          const result = await stripeFetch(
            `/invoices?status=${status}&limit=${limit}&created[gte]=${since}`,
          );
          const invoices = (result.data as Record<string, unknown>[]) || [];

          return {
            success: true,
            data: {
              date_range: dateRange,
              status,
              count: invoices.length,
              invoices: invoices.map((inv) => ({
                id: inv.id,
                customer: inv.customer,
                amount_due: inv.amount_due,
                amount_paid: inv.amount_paid,
                currency: inv.currency,
                status: inv.status,
                created: inv.created,
                due_date: inv.due_date,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Stripe invoices failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_customer_ltv ──────────────────── */
    {
      name: 'get_customer_ltv',
      description:
        'Calculate customer lifetime value segmented by plan, signup cohort, or acquisition channel. ' +
        'Returns average LTV, distribution, and payback period.',
      parameters: {
        segment: {
          type: 'string',
          description: 'Dimension to segment LTV by.',
          enum: ['plan', 'signup_cohort', 'channel'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const segment = params.segment as string;

        try {
          const rows = await systemQuery(
            `SELECT
               sd.${segment} AS segment_value,
               ROUND(AVG(sd.total_revenue), 2) AS average_ltv,
               ROUND(MIN(sd.total_revenue), 2) AS min_ltv,
               ROUND(MAX(sd.total_revenue), 2) AS max_ltv,
               COUNT(*) AS customer_count,
               ROUND(AVG(sd.total_revenue) / NULLIF(AVG(f.mrr), 0), 1) AS payback_period_months
             FROM stripe_data sd
             LEFT JOIN financials f ON sd.customer_id = f.customer_id
             GROUP BY sd.${segment}
             ORDER BY average_ltv DESC`,
            [],
          );

          return {
            success: true,
            data: {
              segment,
              ltv_distribution: rows.map((r) => ({
                segment_value: r.segment_value,
                average_ltv: r.average_ltv,
                min_ltv: r.min_ltv,
                max_ltv: r.max_ltv,
                customer_count: r.customer_count,
                payback_period_months: r.payback_period_months,
              })),
              average_ltv:
                rows.length > 0
                  ? Math.round(
                      rows.reduce((sum, r) => sum + Number(r.average_ltv), 0) / rows.length * 100,
                    ) / 100
                  : 0,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Customer LTV failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
