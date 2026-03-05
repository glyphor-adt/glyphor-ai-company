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

  ];
}
