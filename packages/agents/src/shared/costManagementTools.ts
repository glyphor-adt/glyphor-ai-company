/**
 * Cost Management Tools — Shared financial cost analysis tools
 *
 * Tools:
 *   get_gcp_costs          — Detailed GCP cost breakdown
 *   get_ai_model_costs     — AI inference cost breakdown
 *   get_vendor_costs        — All vendor/SaaS costs
 *   get_cost_anomalies     — Detect unusual spending
 *   get_burn_rate           — Monthly burn rate and runway
 *   create_budget           — Set monthly budget limits
 *   check_budget_status    — Compare actual spend vs budget
 *   get_unit_economics     — Calculate key unit economics
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createCostManagementTools(): ToolDefinition[] {
  return [
    // ── 1. get_gcp_costs ──────────────────────────────────────────────────
    {
      name: 'get_gcp_costs',
      description:
        'Get a detailed GCP cost breakdown grouped by service, SKU, project, or label. ' +
        'Returns cost per category with daily trend data.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time period to analyze',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        group_by: {
          type: 'string',
          description: 'Dimension to group costs by',
          required: true,
          enum: ['service', 'sku', 'project', 'label'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const days = params.date_range === '7d' ? 7 : params.date_range === '30d' ? 30 : 90;
        const groupCol = params.group_by as string;

        try {
          const breakdown = await systemQuery<{ category: string; total_cost: number; record_count: number }>(
            `SELECT ${groupCol} AS category, SUM(cost) AS total_cost, COUNT(*) AS record_count
             FROM gcp_billing
             WHERE recorded_at >= NOW() - INTERVAL '${days} days'
             GROUP BY ${groupCol}
             ORDER BY total_cost DESC`,
          );

          const dailyTrend = await systemQuery<{ day: string; daily_total: number }>(
            `SELECT DATE(recorded_at) AS day, SUM(cost) AS daily_total
             FROM gcp_billing
             WHERE recorded_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(recorded_at)
             ORDER BY day`,
          );

          const totalCost = breakdown.reduce((sum, r) => sum + Number(r.total_cost), 0);

          return {
            success: true,
            data: {
              date_range: params.date_range,
              group_by: groupCol,
              total_cost: totalCost,
              breakdown,
              daily_trend: dailyTrend,
            },
          };
        } catch (err) {
          return { success: false, error: `GCP cost query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 2. get_ai_model_costs ─────────────────────────────────────────────
    {
      name: 'get_ai_model_costs',
      description:
        'Get AI inference cost breakdown by model, agent, or department. ' +
        'Returns cost per model, cost per agent, total tokens, and average cost per run.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time period to analyze',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        group_by: {
          type: 'string',
          description: 'Dimension to group costs by',
          required: true,
          enum: ['model', 'agent', 'department'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const days = params.date_range === '7d' ? 7 : params.date_range === '30d' ? 30 : 90;
        const groupBy = params.group_by as string;
        const groupCol = groupBy === 'agent' ? 'agent_role' : groupBy === 'department' ? 'department' : 'model';

        try {
          const breakdown = await systemQuery<{
            category: string;
            total_cost: number;
            total_tokens: number;
            run_count: number;
            avg_cost_per_run: number;
          }>(
            `SELECT ${groupCol} AS category,
                    SUM(cost_usd) AS total_cost,
                    SUM(tokens_used) AS total_tokens,
                    COUNT(*) AS run_count,
                    AVG(cost_usd) AS avg_cost_per_run
             FROM agent_runs
             WHERE created_at >= NOW() - INTERVAL '${days} days'
             GROUP BY ${groupCol}
             ORDER BY total_cost DESC`,
          );

          const totalCost = breakdown.reduce((sum, r) => sum + Number(r.total_cost), 0);
          const totalTokens = breakdown.reduce((sum, r) => sum + Number(r.total_tokens), 0);
          const totalRuns = breakdown.reduce((sum, r) => sum + Number(r.run_count), 0);

          return {
            success: true,
            data: {
              date_range: params.date_range,
              group_by: groupBy,
              total_cost: totalCost,
              total_tokens: totalTokens,
              total_runs: totalRuns,
              avg_cost_per_run: totalRuns > 0 ? totalCost / totalRuns : 0,
              breakdown,
            },
          };
        } catch (err) {
          return { success: false, error: `AI model cost query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 3. get_vendor_costs ───────────────────────────────────────────────
    {
      name: 'get_vendor_costs',
      description:
        'Get all vendor and SaaS costs. Returns vendor name, amount, frequency, and category.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time period to analyze',
          required: true,
          enum: ['30d', '90d', '365d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const days = params.date_range === '30d' ? 30 : params.date_range === '90d' ? 90 : 365;

        try {
          const vendors = await systemQuery<{
            vendor: string;
            amount: number;
            frequency: string;
            category: string;
          }>(
            `SELECT vendor, SUM(amount) AS amount, frequency, category
             FROM financials
             WHERE category IN ('vendor_costs', 'infrastructure_costs')
               AND recorded_at >= NOW() - INTERVAL '${days} days'
             GROUP BY vendor, frequency, category
             ORDER BY amount DESC`,
          );

          const totalSpend = vendors.reduce((sum, v) => sum + Number(v.amount), 0);

          return {
            success: true,
            data: {
              date_range: params.date_range,
              total_vendor_spend: totalSpend,
              vendor_count: vendors.length,
              vendors,
            },
          };
        } catch (err) {
          return { success: false, error: `Vendor cost query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 4. get_cost_anomalies ─────────────────────────────────────────────
    {
      name: 'get_cost_anomalies',
      description:
        'Detect unusual spending patterns by comparing daily costs against historical mean. ' +
        'Flags days that exceed the mean by a configurable number of standard deviations.',
      parameters: {
        lookback_days: {
          type: 'number',
          description: 'Number of days to analyze (default: 30)',
          required: false,
        },
        sensitivity: {
          type: 'string',
          description: 'Detection sensitivity: low (3σ), medium (2σ), or high (1.5σ)',
          required: true,
          enum: ['low', 'medium', 'high'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const lookback = (params.lookback_days as number) || 30;
        const sigmaMultiplier = params.sensitivity === 'low' ? 3 : params.sensitivity === 'medium' ? 2 : 1.5;

        try {
          const dailyTotals = await systemQuery<{ day: string; daily_cost: number }>(
            `SELECT DATE(recorded_at) AS day, SUM(cost) AS daily_cost
             FROM gcp_billing
             WHERE recorded_at >= NOW() - INTERVAL '${lookback} days'
             GROUP BY DATE(recorded_at)
             ORDER BY day`,
          );

          if (dailyTotals.length < 3) {
            return { success: true, data: { message: 'Insufficient data for anomaly detection', days_available: dailyTotals.length } };
          }

          const costs = dailyTotals.map((r) => Number(r.daily_cost));
          const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
          const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length;
          const stddev = Math.sqrt(variance);
          const threshold = mean + sigmaMultiplier * stddev;

          const anomalies = dailyTotals
            .filter((r) => Number(r.daily_cost) > threshold)
            .map((r) => ({
              day: r.day,
              actual_cost: Number(r.daily_cost),
              expected_cost: Math.round(mean * 100) / 100,
              deviation: Math.round(((Number(r.daily_cost) - mean) / stddev) * 100) / 100,
              severity: Number(r.daily_cost) > mean + 3 * stddev ? 'critical' : Number(r.daily_cost) > mean + 2 * stddev ? 'high' : 'moderate',
            }));

          return {
            success: true,
            data: {
              lookback_days: lookback,
              sensitivity: params.sensitivity,
              sigma_multiplier: sigmaMultiplier,
              mean_daily_cost: Math.round(mean * 100) / 100,
              stddev: Math.round(stddev * 100) / 100,
              threshold: Math.round(threshold * 100) / 100,
              anomaly_count: anomalies.length,
              anomalies,
            },
          };
        } catch (err) {
          return { success: false, error: `Anomaly detection failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 5. get_burn_rate ──────────────────────────────────────────────────
    {
      name: 'get_burn_rate',
      description:
        'Calculate monthly burn rate and runway. Returns current monthly burn, cash balance, ' +
        'runway in months, and month-over-month trend.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const monthlyCosts = await systemQuery<{ month: string; total_cost: number }>(
            `SELECT TO_CHAR(recorded_at, 'YYYY-MM') AS month, SUM(amount) AS total_cost
             FROM financials
             GROUP BY TO_CHAR(recorded_at, 'YYYY-MM')
             ORDER BY month DESC
             LIMIT 6`,
          );

          const cashRows = await systemQuery<{ cash_balance: number }>(
            `SELECT amount AS cash_balance
             FROM financials
             WHERE category = 'cash_balance'
             ORDER BY recorded_at DESC
             LIMIT 1`,
          );

          if (monthlyCosts.length === 0) {
            return { success: true, data: { message: 'No financial data available' } };
          }

          const currentBurn = Number(monthlyCosts[0].total_cost);
          const previousBurn = monthlyCosts.length > 1 ? Number(monthlyCosts[1].total_cost) : currentBurn;
          const cashBalance = cashRows.length > 0 ? Number(cashRows[0].cash_balance) : 0;
          const runwayMonths = currentBurn > 0 ? Math.round((cashBalance / currentBurn) * 10) / 10 : null;
          const trend = previousBurn > 0
            ? Math.round(((currentBurn - previousBurn) / previousBurn) * 1000) / 10
            : 0;

          return {
            success: true,
            data: {
              monthly_burn: currentBurn,
              cash_balance: cashBalance,
              runway_months: runwayMonths,
              trend_pct: trend,
              monthly_history: monthlyCosts,
            },
          };
        } catch (err) {
          return { success: false, error: `Burn rate calculation failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 6. create_budget ──────────────────────────────────────────────────
    {
      name: 'create_budget',
      description:
        'Set a monthly budget limit for a category. Logs the budget to the activity log for tracking.',
      parameters: {
        category: {
          type: 'string',
          description: 'Budget category (e.g., "gcp", "ai_inference", "saas")',
          required: true,
        },
        monthly_limit: {
          type: 'number',
          description: 'Monthly budget limit in USD',
          required: true,
        },
        alert_threshold_pct: {
          type: 'number',
          description: 'Alert when spend reaches this percentage of budget (default: 80)',
        },
      },
      async execute(params): Promise<ToolResult> {
        const category = params.category as string;
        const monthlyLimit = params.monthly_limit as number;
        const alertPct = (params.alert_threshold_pct as number) || 80;

        if (monthlyLimit <= 0) {
          return { success: false, error: 'monthly_limit must be a positive number' };
        }

        try {
          await systemQuery(
            `INSERT INTO activity_log (event_type, category, details, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [
              'budget_created',
              category,
              JSON.stringify({ monthly_limit: monthlyLimit, alert_threshold_pct: alertPct }),
            ],
          );

          return {
            success: true,
            data: {
              category,
              monthly_limit: monthlyLimit,
              alert_threshold_pct: alertPct,
              message: `Budget set: $${monthlyLimit}/month for "${category}" with alert at ${alertPct}%`,
            },
          };
        } catch (err) {
          return { success: false, error: `Budget creation failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 7. check_budget_status ────────────────────────────────────────────
    {
      name: 'check_budget_status',
      description:
        'Compare actual spend vs budget for a category. Returns budget utilization percentage ' +
        'and overspend alerts.',
      parameters: {
        category: {
          type: 'string',
          description: 'Budget category to check (e.g., "gcp", "ai_inference", "saas")',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const category = params.category as string;

        try {
          // Get the latest budget for this category
          const budgets = await systemQuery<{ details: string }>(
            `SELECT details
             FROM activity_log
             WHERE event_type = 'budget_created' AND category = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [category],
          );

          if (budgets.length === 0) {
            return { success: false, error: `No budget found for category "${category}"` };
          }

          const budget = JSON.parse(budgets[0].details) as { monthly_limit: number; alert_threshold_pct: number };

          // Get actual spend for the current month
          const spendRows = await systemQuery<{ actual_spend: number }>(
            `SELECT COALESCE(SUM(cost), 0) AS actual_spend
             FROM gcp_billing
             WHERE recorded_at >= DATE_TRUNC('month', NOW())`,
          );

          const vendorSpend = await systemQuery<{ actual_spend: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS actual_spend
             FROM financials
             WHERE category IN ('vendor_costs', 'infrastructure_costs')
               AND recorded_at >= DATE_TRUNC('month', NOW())`,
          );

          const gcpSpend = spendRows.length > 0 ? Number(spendRows[0].actual_spend) : 0;
          const saasSpend = vendorSpend.length > 0 ? Number(vendorSpend[0].actual_spend) : 0;
          const actualSpend = category === 'gcp' ? gcpSpend : category === 'saas' ? saasSpend : gcpSpend + saasSpend;
          const utilization = budget.monthly_limit > 0 ? Math.round((actualSpend / budget.monthly_limit) * 1000) / 10 : 0;
          const overBudget = actualSpend > budget.monthly_limit;
          const alertTriggered = utilization >= budget.alert_threshold_pct;

          return {
            success: true,
            data: {
              category,
              monthly_limit: budget.monthly_limit,
              actual_spend: Math.round(actualSpend * 100) / 100,
              utilization_pct: utilization,
              alert_threshold_pct: budget.alert_threshold_pct,
              alert_triggered: alertTriggered,
              over_budget: overBudget,
              remaining: Math.round((budget.monthly_limit - actualSpend) * 100) / 100,
            },
          };
        } catch (err) {
          return { success: false, error: `Budget status check failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 8. get_unit_economics ─────────────────────────────────────────────
    {
      name: 'get_unit_economics',
      description:
        'Calculate key unit economics including CAC, LTV, LTV/CAC ratio, payback period, ' +
        'and gross margin from financial and Stripe data.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const revenueRows = await systemQuery<{ total_revenue: number; customer_count: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS total_revenue, COUNT(DISTINCT customer_id) AS customer_count
             FROM stripe_data
             WHERE type = 'payment'
               AND created_at >= NOW() - INTERVAL '30 days'`,
          );

          const costRows = await systemQuery<{ total_costs: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS total_costs
             FROM financials
             WHERE recorded_at >= NOW() - INTERVAL '30 days'`,
          );

          const marketingRows = await systemQuery<{ marketing_spend: number }>(
            `SELECT COALESCE(SUM(amount), 0) AS marketing_spend
             FROM financials
             WHERE category = 'marketing'
               AND recorded_at >= NOW() - INTERVAL '30 days'`,
          );

          const churnRows = await systemQuery<{ churned: number; total: number }>(
            `SELECT
               COUNT(CASE WHEN type = 'churn' THEN 1 END) AS churned,
               COUNT(CASE WHEN type = 'subscription' THEN 1 END) AS total
             FROM stripe_data
             WHERE created_at >= NOW() - INTERVAL '90 days'`,
          );

          const revenue = revenueRows.length > 0 ? Number(revenueRows[0].total_revenue) : 0;
          const customers = revenueRows.length > 0 ? Number(revenueRows[0].customer_count) : 0;
          const totalCosts = costRows.length > 0 ? Number(costRows[0].total_costs) : 0;
          const marketingSpend = marketingRows.length > 0 ? Number(marketingRows[0].marketing_spend) : 0;
          const churned = churnRows.length > 0 ? Number(churnRows[0].churned) : 0;
          const totalSubs = churnRows.length > 0 ? Number(churnRows[0].total) : 0;

          const monthlyChurnRate = totalSubs > 0 ? churned / totalSubs / 3 : 0; // 90-day window → monthly
          const arpu = customers > 0 ? revenue / customers : 0;
          const cac = customers > 0 ? marketingSpend / customers : 0;
          const ltv = monthlyChurnRate > 0 ? arpu / monthlyChurnRate : arpu * 24; // fallback: 24-month estimate
          const ltvCacRatio = cac > 0 ? Math.round((ltv / cac) * 100) / 100 : null;
          const paybackMonths = arpu > 0 ? Math.round((cac / arpu) * 10) / 10 : null;
          const grossMarginPct = revenue > 0 ? Math.round(((revenue - totalCosts) / revenue) * 1000) / 10 : 0;

          return {
            success: true,
            data: {
              cac: Math.round(cac * 100) / 100,
              ltv: Math.round(ltv * 100) / 100,
              ltv_cac_ratio: ltvCacRatio,
              payback_period_months: paybackMonths,
              gross_margin_pct: grossMarginPct,
              monthly_revenue: revenue,
              total_customers: customers,
              monthly_churn_rate: Math.round(monthlyChurnRate * 10000) / 100,
              calculated_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Unit economics calculation failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
