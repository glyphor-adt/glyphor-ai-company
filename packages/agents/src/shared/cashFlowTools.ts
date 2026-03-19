/**
 * Cash Flow Tools — Financial cash flow analysis and reporting
 *
 * Tools:
 *   get_cash_balance          — Current cash balance from Mercury
 *   get_cash_flow             — Cash flow statement for a period
 *   get_pending_transactions  — List pending/recent transactions
 *   generate_financial_report — Compile formatted financial report
 *   get_margin_analysis       — Gross and net margin by product
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

async function mercuryFetch(path: string): Promise<Record<string, unknown>> {
  const token = process.env.MERCURY_API_TOKEN;
  if (!token) throw new Error('MERCURY_API_TOKEN not configured');
  const res = await fetch(`https://api.mercury.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return await res.json() as Record<string, unknown>;
}

export function createCashFlowTools(): ToolDefinition[] {
  return [
    // ── 1. get_cash_balance ─────────────────────────────────────────────
    {
      name: 'get_cash_balance',
      description:
        'Get current cash balance from Mercury bank accounts. Returns account balances, ' +
        'pending transaction count, and total available funds.',
      parameters: {},
      async execute(_params): Promise<ToolResult> {
        try {
          const data = await mercuryFetch('/accounts');
          const accounts = (data.accounts ?? data) as Array<Record<string, unknown>>;

          const balances = accounts.map((a) => ({
            id: a.id,
            name: a.name ?? a.accountName,
            balance: a.currentBalance ?? a.availableBalance ?? a.balance,
            type: a.type ?? a.accountType,
          }));

          const totalAvailable = balances.reduce(
            (sum, a) => sum + (typeof a.balance === 'number' ? a.balance : 0),
            0,
          );

          // Check for pending transactions count
          let pendingCount = 0;
          try {
            const pending = await mercuryFetch('/transactions?status=pending');
            const txns = (pending.transactions ?? pending) as unknown[];
            pendingCount = txns.length;
          } catch {
            // Pending count unavailable — not critical
          }

          return {
            success: true,
            data: {
              account_balances: balances,
              pending_transactions_count: pendingCount,
              available_funds: totalAvailable,
              queried_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          // Fallback: query financials table for latest balance
          try {
            const rows = await systemQuery<{ total_balance: number; snapshot_date: string }>(
              `SELECT SUM(value) as total_balance, MAX(date::date)::text as snapshot_date
               FROM financials
               WHERE metric = 'cash_balance'
               ORDER BY date DESC LIMIT 1`,
            );
            const row = rows[0];
            return {
              success: true,
              data: {
                account_balances: [{ name: 'primary', balance: row?.total_balance ?? 0 }],
                pending_transactions_count: 0,
                available_funds: row?.total_balance ?? 0,
                source: 'database_fallback',
                snapshot_date: row?.snapshot_date ?? null,
              },
            };
          } catch (dbErr) {
            return {
              success: false,
              error: `Mercury API failed: ${(err as Error).message}; DB fallback also failed: ${(dbErr as Error).message}`,
            };
          }
        }
      },
    },

    // ── 2. get_cash_flow ────────────────────────────────────────────────
    {
      name: 'get_cash_flow',
      description:
        'Get a cash flow statement for a given period. Returns total inflows, outflows, ' +
        'net cash flow, and breakdowns by category.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time period for the cash flow statement',
          required: true,
          enum: ['30d', '90d', '180d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const range = params.date_range as string;
        const days = parseInt(range, 10);

        try {
          const inflows = await systemQuery<{ category: string; total: number }>(
            `SELECT metric AS category, SUM(value) as total
             FROM financials
             WHERE value > 0 AND date >= NOW() - INTERVAL '${days} days'
             GROUP BY metric
             ORDER BY total DESC`,
          );

          const outflows = await systemQuery<{ category: string; total: number }>(
            `SELECT metric AS category, SUM(ABS(value)) as total
             FROM financials
             WHERE value < 0 AND date >= NOW() - INTERVAL '${days} days'
             GROUP BY metric
             ORDER BY total DESC`,
          );

          const totalInflows = inflows.reduce((s, r) => s + r.total, 0);
          const totalOutflows = outflows.reduce((s, r) => s + r.total, 0);

          return {
            success: true,
            data: {
              date_range: range,
              total_inflows: totalInflows,
              total_outflows: totalOutflows,
              net_cash_flow: totalInflows - totalOutflows,
              inflows_by_category: Object.fromEntries(inflows.map((r) => [r.category, r.total])),
              outflows_by_category: Object.fromEntries(outflows.map((r) => [r.category, r.total])),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Cash flow query failed: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 3. get_pending_transactions ──────────────────────────────────────
    {
      name: 'get_pending_transactions',
      description:
        'List pending or recent transactions. Tries Mercury API first and falls back ' +
        'to the financials table. Returns transaction list with amounts, counterparties, and dates.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'How far back to look',
          enum: ['7d', '30d'],
        },
        type: {
          type: 'string',
          description: 'Filter by transaction direction',
          enum: ['inflow', 'outflow', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const range = params.date_range as string || '7d';
        const txnType = params.type as string || 'all';
        const days = parseInt(range, 10);

        // Try Mercury API first
        try {
          const data = await mercuryFetch('/transactions?status=pending&limit=100');
          const rawTxns = (data.transactions ?? data) as Array<Record<string, unknown>>;

          let transactions = rawTxns.map((t) => ({
            id: t.id,
            amount: t.amount,
            counterparty: t.counterpartyName ?? t.counterparty ?? t.description,
            category: t.category ?? t.kind,
            date: t.createdAt ?? t.postedAt ?? t.date,
            status: t.status,
            direction: typeof t.amount === 'number' && t.amount > 0 ? 'inflow' : 'outflow',
          }));

          if (txnType !== 'all') {
            transactions = transactions.filter((t) => t.direction === txnType);
          }

          return {
            success: true,
            data: {
              source: 'mercury_api',
              date_range: range,
              filter: txnType,
              count: transactions.length,
              transactions,
            },
          };
        } catch {
          // Fallback to database
        }

        try {
          const typeFilter =
            txnType === 'inflow' ? 'AND value > 0' :
            txnType === 'outflow' ? 'AND value < 0' :
            '';

          const rows = await systemQuery<{
            id: string; value: number; metric: string;
            product: string; date: string;
          }>(
            `SELECT id, value, metric, product, date::text as date
             FROM financials
             WHERE date >= NOW() - INTERVAL '${days} days' ${typeFilter}
             ORDER BY date DESC
             LIMIT 100`,
          );

          const transactions = rows.map((r) => ({
            id: r.id,
            amount: r.value,
            counterparty: r.product,
            category: r.metric,
            date: r.date,
            direction: r.value > 0 ? 'inflow' : 'outflow',
          }));

          return {
            success: true,
            data: {
              source: 'database_fallback',
              date_range: range,
              filter: txnType,
              count: transactions.length,
              transactions,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch transactions: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 4. generate_financial_report ─────────────────────────────────────
    {
      name: 'generate_financial_report',
      description:
        'Compile a comprehensive financial report by querying financials, stripe_data, ' +
        'gcp_billing, and company_pulse tables. Returns structured report with revenue, ' +
        'costs, margins, and cash position.',
      parameters: {
        report_type: {
          type: 'string',
          description: 'Report cadence',
          required: true,
          enum: ['daily', 'weekly', 'monthly'],
        },
        date_range: {
          type: 'string',
          description: 'Custom date range (e.g., "2024-01-01 to 2024-01-31"). Defaults to report_type cadence.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const reportType = params.report_type as string;
        const days = reportType === 'daily' ? 1 : reportType === 'weekly' ? 7 : 30;
        const interval = `${days} days`;

        try {
          const [revenue, costs, gcpBilling, pulse] = await Promise.all([
            systemQuery<{ source: string; total: number }>(
              `SELECT record_type AS source, SUM(amount_usd) as total
               FROM stripe_data
               WHERE recorded_at >= NOW() - INTERVAL '${interval}'
               GROUP BY record_type`,
            ),
            systemQuery<{ category: string; total: number }>(
              `SELECT metric AS category, SUM(ABS(value)) as total
               FROM financials
               WHERE value < 0 AND date >= NOW() - INTERVAL '${interval}'
               GROUP BY metric`,
            ),
            systemQuery<{ service: string; total: number }>(
              `SELECT service, SUM(cost_usd) as total
               FROM gcp_billing
               WHERE recorded_at >= NOW() - INTERVAL '${interval}'
               GROUP BY service
               ORDER BY total DESC`,
            ),
            systemQuery<{ metric: string; value: number }>(
              `SELECT metric, value
               FROM company_vitals
               WHERE recorded_at >= NOW() - INTERVAL '${interval}'
               ORDER BY recorded_at DESC`,
            ),
          ]);

          const totalRevenue = revenue.reduce((s, r) => s + r.total, 0);
          const totalCosts = costs.reduce((s, r) => s + r.total, 0);
          const totalGcp = gcpBilling.reduce((s, r) => s + r.total, 0);
          const grossMargin = totalRevenue > 0
            ? ((totalRevenue - totalGcp) / totalRevenue * 100)
            : 0;
          const netMargin = totalRevenue > 0
            ? ((totalRevenue - totalCosts) / totalRevenue * 100)
            : 0;

          return {
            success: true,
            data: {
              report_type: reportType,
              period_days: days,
              generated_at: new Date().toISOString(),
              revenue: {
                total: totalRevenue,
                by_source: Object.fromEntries(revenue.map((r) => [r.source, r.total])),
              },
              costs: {
                total: totalCosts,
                by_category: Object.fromEntries(costs.map((r) => [r.category, r.total])),
              },
              infrastructure: {
                total_gcp: totalGcp,
                by_service: Object.fromEntries(gcpBilling.map((r) => [r.service, r.total])),
              },
              margins: {
                gross_margin_pct: Number(grossMargin.toFixed(1)),
                net_margin_pct: Number(netMargin.toFixed(1)),
              },
              cash_position: {
                net_cash_flow: totalRevenue - totalCosts,
              },
              pulse_metrics: Object.fromEntries(pulse.map((r) => [r.metric, r.value])),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Financial report generation failed: ${(err as Error).message}`,
          };
        }
      },
    },

    // ── 5. get_margin_analysis ───────────────────────────────────────────
    {
      name: 'get_margin_analysis',
      description:
        'Analyze gross and net margins by product. Queries stripe_data for revenue, ' +
        'gcp_billing for COGS, and financials for operating expenses.',
      parameters: {
        product: {
          type: 'string',
          description: 'Internal engine to analyze',
          enum: ['all'],
        },
        date_range: {
          type: 'string',
          description: 'Time period for margin analysis',
          enum: ['30d', '90d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const product = params.product as string || 'all';
        const range = params.date_range as string || '30d';
        const days = parseInt(range, 10);
        const interval = `${days} days`;

        const productArgs: unknown[] = [];
        let productClause = '';
        if (product !== 'all') {
          productArgs.push(product);
          productClause = `AND product = $1`;
        }

        try {
          const [revenueRows, cogsRows, opexRows] = await Promise.all([
            systemQuery<{ product: string; total: number }>(
              `SELECT product, SUM(amount_usd) as total
               FROM stripe_data
               WHERE recorded_at >= NOW() - INTERVAL '${interval}' ${productClause}
               GROUP BY product`,
              productArgs,
            ),
            systemQuery<{ product: string; total: number }>(
              `SELECT product, SUM(cost_usd) as total
               FROM gcp_billing
               WHERE recorded_at >= NOW() - INTERVAL '${interval}' ${productClause}
               GROUP BY product`,
              productArgs,
            ),
            systemQuery<{ product: string; total: number }>(
              `SELECT COALESCE(product, 'shared') as product, SUM(ABS(value)) as total
               FROM financials
               WHERE value < 0 AND metric != 'cogs'
                 AND date >= NOW() - INTERVAL '${interval}' ${productClause}
               GROUP BY product`,
              productArgs,
            ),
          ]);

          const products = product !== 'all' ? [product] : [
            ...new Set([
              ...revenueRows.map((r) => r.product),
              ...cogsRows.map((r) => r.product),
            ]),
          ];

          const analysis = products.map((p) => {
            const revenue = revenueRows.find((r) => r.product === p)?.total ?? 0;
            const cogs = cogsRows.find((r) => r.product === p)?.total ?? 0;
            const opex = opexRows.find((r) => r.product === p)?.total ?? 0;
            const grossMargin = revenue - cogs;
            const netMargin = grossMargin - opex;

            return {
              product: p,
              revenue,
              cogs,
              gross_margin: grossMargin,
              gross_margin_pct: revenue > 0 ? Number(((grossMargin / revenue) * 100).toFixed(1)) : 0,
              operating_expenses: opex,
              net_margin: netMargin,
              net_margin_pct: revenue > 0 ? Number(((netMargin / revenue) * 100).toFixed(1)) : 0,
            };
          });

          const totals = {
            revenue: analysis.reduce((s, a) => s + a.revenue, 0),
            cogs: analysis.reduce((s, a) => s + a.cogs, 0),
            gross_margin: analysis.reduce((s, a) => s + a.gross_margin, 0),
            operating_expenses: analysis.reduce((s, a) => s + a.operating_expenses, 0),
            net_margin: analysis.reduce((s, a) => s + a.net_margin, 0),
          };

          return {
            success: true,
            data: {
              date_range: range,
              filter: product,
              by_product: analysis,
              totals: {
                ...totals,
                gross_margin_pct: totals.revenue > 0
                  ? Number(((totals.gross_margin / totals.revenue) * 100).toFixed(1))
                  : 0,
                net_margin_pct: totals.revenue > 0
                  ? Number(((totals.net_margin / totals.revenue) * 100).toFixed(1))
                  : 0,
              },
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Margin analysis failed: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
