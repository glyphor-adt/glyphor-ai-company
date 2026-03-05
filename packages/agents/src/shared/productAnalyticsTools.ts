/**
 * Product Analytics Tools — Shared tools for product usage analytics
 *
 * Tools:
 *   query_analytics_events — Query the analytics_events table with filters
 *   get_usage_metrics      — Aggregated product usage metrics (DAU, WAU, MAU, etc.)
 *   get_funnel_analysis    — Analyze conversion funnels with step-by-step rates
 *   get_cohort_retention   — Retention curves by signup cohort
 *   get_feature_usage      — Usage breakdown by specific features
 *   segment_users          — Segment users by behavioral criteria
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createProductAnalyticsTools(): ToolDefinition[] {
  return [
    /* ── get_usage_metrics ─────────────────── */
    {
      name: 'get_usage_metrics',
      description:
        'Aggregated product usage metrics. Returns a time series of the requested metric ' +
        '(DAU, WAU, MAU, session duration, feature usage, or retention) with period-over-period comparison.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product to analyze.',
          required: true,
          enum: ['pulse', 'fuse'],
        },
        date_range: {
          type: 'string',
          description: 'Time window for metrics.',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
        metric: {
          type: 'string',
          description: 'Usage metric to retrieve.',
          required: true,
          enum: ['dau', 'wau', 'mau', 'session_duration', 'feature_usage', 'retention'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const product = params.product as string;
        const dateRange = params.date_range as string;
        const metric = params.metric as string;

        try {
          let selectExpr: string;
          switch (metric) {
            case 'dau':
              selectExpr = 'COUNT(DISTINCT user_id)';
              break;
            case 'wau':
              selectExpr = 'COUNT(DISTINCT user_id)';
              break;
            case 'mau':
              selectExpr = 'COUNT(DISTINCT user_id)';
              break;
            case 'session_duration':
              selectExpr = "ROUND(AVG(EXTRACT(EPOCH FROM (properties->>'duration')::interval)), 2)";
              break;
            case 'feature_usage':
              selectExpr = 'COUNT(*)';
              break;
            case 'retention':
              selectExpr = 'COUNT(DISTINCT user_id)';
              break;
            default:
              selectExpr = 'COUNT(*)';
          }

          const groupExpr =
            metric === 'wau'
              ? "DATE_TRUNC('week', created_at)"
              : metric === 'mau'
                ? "DATE_TRUNC('month', created_at)"
                : 'DATE(created_at)';

          const currentPeriod = await systemQuery(
            `SELECT ${groupExpr} AS period,
                    ${selectExpr} AS value
             FROM analytics_events
             WHERE product = $1
               AND created_at >= NOW() - CAST($2 AS INTERVAL)
             GROUP BY ${groupExpr}
             ORDER BY period`,
            [product, dateRange],
          );

          const previousPeriod = await systemQuery(
            `SELECT ${groupExpr} AS period,
                    ${selectExpr} AS value
             FROM analytics_events
             WHERE product = $1
               AND created_at >= NOW() - 2 * CAST($2 AS INTERVAL)
               AND created_at < NOW() - CAST($2 AS INTERVAL)
             GROUP BY ${groupExpr}
             ORDER BY period`,
            [product, dateRange],
          );

          const currentTotal = currentPeriod.reduce((s, r) => s + Number(r.value), 0);
          const previousTotal = previousPeriod.reduce((s, r) => s + Number(r.value), 0);
          const changePercent =
            previousTotal > 0
              ? Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100
              : null;

          return {
            success: true,
            data: {
              product,
              metric,
              date_range: dateRange,
              time_series: currentPeriod,
              previous_period: previousPeriod,
              current_total: currentTotal,
              previous_total: previousTotal,
              change_percent: changePercent,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Usage metrics failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_funnel_analysis ────────────────── */
    {
      name: 'get_funnel_analysis',
      description:
        'Analyze conversion funnels. Provide comma-separated step names and receive the number of ' +
        'unique users at each step with step-to-step and overall conversion rates.',
      parameters: {
        funnel_steps: {
          type: 'string',
          description: 'Comma-separated ordered funnel step names (e.g. "signup,onboarding,first_action,upgrade").',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Product to analyze.',
          required: true,
          enum: ['pulse', 'fuse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        if (!params.funnel_steps) return { success: false, error: 'funnel_steps parameter is required' };
        const stepsRaw = params.funnel_steps as string;
        const product = params.product as string;
        const steps = stepsRaw.split(',').map((s) => s.trim()).filter(Boolean);

        if (steps.length < 2) {
          return { success: false, error: 'At least two funnel steps are required.' };
        }

        try {
          const stepResults: { step: string; unique_users: number; conversion_rate: number }[] = [];
          let firstStepUsers = 0;

          for (let i = 0; i < steps.length; i++) {
            const rows = await systemQuery<{ unique_users: number }>(
              `SELECT COUNT(DISTINCT user_id) AS unique_users
               FROM analytics_events
               WHERE product = $1
                 AND event_type = $2`,
              [product, steps[i]],
            );

            const users = Number(rows[0]?.unique_users ?? 0);
            if (i === 0) firstStepUsers = users;

            const prevUsers = i > 0 ? stepResults[i - 1].unique_users : users;
            const conversionRate =
              prevUsers > 0 ? Math.round((users / prevUsers) * 10000) / 100 : 0;

            stepResults.push({
              step: steps[i],
              unique_users: users,
              conversion_rate: conversionRate,
            });
          }

          const lastStepUsers = stepResults[stepResults.length - 1].unique_users;
          const overallConversion =
            firstStepUsers > 0
              ? Math.round((lastStepUsers / firstStepUsers) * 10000) / 100
              : 0;

          return {
            success: true,
            data: {
              product,
              funnel_steps: stepResults,
              overall_conversion_rate: overallConversion,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Funnel analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_cohort_retention ──────────────── */
    {
      name: 'get_cohort_retention',
      description:
        'Retention curves by signup cohort. Returns a retention matrix showing the percentage of ' +
        'users from each cohort who remain active in subsequent periods.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product to analyze.',
          required: true,
          enum: ['pulse', 'fuse'],
        },
        cohort_period: {
          type: 'string',
          description: 'Granularity for cohort grouping.',
          required: true,
          enum: ['week', 'month'],
        },
        date_range: {
          type: 'string',
          description: 'How far back to look for cohorts.',
          required: true,
          enum: ['30d', '90d', '180d'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const product = params.product as string;
        const cohortPeriod = params.cohort_period as string;
        const dateRange = params.date_range as string;

        try {
          const truncFn = `DATE_TRUNC('${cohortPeriod}', u.created_at)`;
          const periodDiff =
            cohortPeriod === 'week'
              ? `EXTRACT(WEEK FROM ae.created_at) - EXTRACT(WEEK FROM u.created_at)`
              : `EXTRACT(MONTH FROM ae.created_at) - EXTRACT(MONTH FROM u.created_at)`;

          const rows = await systemQuery(
            `SELECT
               ${truncFn} AS cohort,
               (${periodDiff})::int AS period_offset,
               COUNT(DISTINCT ae.user_id) AS active_users
             FROM users u
             JOIN analytics_events ae ON ae.user_id = u.id
             WHERE ae.product = $1
               AND u.created_at >= NOW() - CAST($2 AS INTERVAL)
             GROUP BY cohort, period_offset
             ORDER BY cohort, period_offset`,
            [product, dateRange],
          );

          const cohortSizes = await systemQuery(
            `SELECT
               ${truncFn} AS cohort,
               COUNT(DISTINCT u.id) AS cohort_size
             FROM users u
             WHERE u.created_at >= NOW() - CAST($1 AS INTERVAL)
             GROUP BY cohort
             ORDER BY cohort`,
            [dateRange],
          );

          const sizeMap = new Map<string, number>();
          for (const c of cohortSizes) {
            sizeMap.set(String(c.cohort), Number(c.cohort_size));
          }

          const matrix = rows.map((r) => {
            const cohortKey = String(r.cohort);
            const size = sizeMap.get(cohortKey) || 1;
            return {
              cohort: cohortKey,
              period_offset: r.period_offset,
              active_users: r.active_users,
              retention_rate: Math.round((Number(r.active_users) / size) * 10000) / 100,
            };
          });

          return {
            success: true,
            data: {
              product,
              cohort_period: cohortPeriod,
              date_range: dateRange,
              cohort_sizes: cohortSizes,
              retention_matrix: matrix,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Cohort retention failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_feature_usage ─────────────────── */
    {
      name: 'get_feature_usage',
      description:
        'Usage breakdown by specific features. Returns event counts and unique user counts ' +
        'per feature, optionally filtered to specific feature names.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product to analyze.',
          required: true,
          enum: ['pulse', 'fuse'],
        },
        feature_names: {
          type: 'string',
          description: 'Optional comma-separated feature names to filter (e.g. "dashboard,reports,export").',
        },
      },
      async execute(params): Promise<ToolResult> {
        const product = params.product as string;
        const featureNamesRaw = params.feature_names as string | undefined;

        try {
          let featureFilter = '';
          const values: unknown[] = [product];

          if (featureNamesRaw) {
            const names = featureNamesRaw.split(',').map((s) => s.trim()).filter(Boolean);
            const placeholders = names.map((_, i) => `$${i + 2}`).join(', ');
            featureFilter = `AND event_type IN (${placeholders})`;
            values.push(...names);
          }

          const rows = await systemQuery(
            `SELECT event_type AS feature,
                    COUNT(*) AS usage_count,
                    COUNT(DISTINCT user_id) AS unique_users
             FROM analytics_events
             WHERE product = $1
               ${featureFilter}
             GROUP BY event_type
             ORDER BY usage_count DESC`,
            values,
          );

          const totalUsage = rows.reduce((s, r) => s + Number(r.usage_count), 0);

          return {
            success: true,
            data: {
              product,
              total_usage: totalUsage,
              features: rows.map((r) => ({
                feature: r.feature,
                usage_count: r.usage_count,
                unique_users: r.unique_users,
                usage_share: totalUsage > 0
                  ? Math.round((Number(r.usage_count) / totalUsage) * 10000) / 100
                  : 0,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Feature usage failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── segment_users ─────────────────────── */
    {
      name: 'segment_users',
      description:
        'Segment users by behavioral criteria. Groups users by plan, engagement level, feature usage, ' +
        'or signup date and returns segment sizes with key metrics.',
      parameters: {
        criteria: {
          type: 'string',
          description: 'Segmentation dimension.',
          required: true,
          enum: ['plan', 'engagement_level', 'feature_usage', 'signup_date'],
        },
        product: {
          type: 'string',
          description: 'Product to analyze.',
          required: true,
          enum: ['pulse', 'fuse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const criteria = params.criteria as string;
        const product = params.product as string;

        try {
          let rows: Record<string, unknown>[];

          switch (criteria) {
            case 'plan':
              rows = await systemQuery(
                `SELECT plan AS segment,
                        COUNT(DISTINCT user_id) AS user_count,
                        COUNT(*) AS total_events,
                        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT user_id), 0), 2) AS avg_events_per_user
                 FROM analytics_events
                 WHERE product = $1
                 GROUP BY plan
                 ORDER BY user_count DESC`,
                [product],
              );
              break;

            case 'engagement_level':
              rows = await systemQuery(
                `SELECT
                   CASE
                     WHEN event_count >= 50 THEN 'power_user'
                     WHEN event_count >= 10 THEN 'active'
                     WHEN event_count >= 1  THEN 'casual'
                     ELSE 'inactive'
                   END AS segment,
                   COUNT(*) AS user_count,
                   ROUND(AVG(event_count), 2) AS avg_events
                 FROM (
                   SELECT user_id, COUNT(*) AS event_count
                   FROM analytics_events
                   WHERE product = $1
                     AND created_at >= NOW() - INTERVAL '30 days'
                   GROUP BY user_id
                 ) sub
                 GROUP BY segment
                 ORDER BY user_count DESC`,
                [product],
              );
              break;

            case 'feature_usage':
              rows = await systemQuery(
                `SELECT event_type AS segment,
                        COUNT(DISTINCT user_id) AS user_count,
                        COUNT(*) AS total_events
                 FROM analytics_events
                 WHERE product = $1
                 GROUP BY event_type
                 ORDER BY user_count DESC`,
                [product],
              );
              break;

            case 'signup_date':
              rows = await systemQuery(
                `SELECT DATE_TRUNC('month', u.created_at)::date AS segment,
                        COUNT(DISTINCT ae.user_id) AS user_count,
                        COUNT(*) AS total_events,
                        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT ae.user_id), 0), 2) AS avg_events_per_user
                 FROM analytics_events ae
                 JOIN users u ON u.id = ae.user_id
                 WHERE ae.product = $1
                 GROUP BY DATE_TRUNC('month', u.created_at)
                 ORDER BY segment DESC`,
                [product],
              );
              break;

            default:
              return { success: false, error: `Unknown segmentation criteria: ${criteria}` };
          }

          const totalUsers = rows.reduce((s, r) => s + Number(r.user_count), 0);

          return {
            success: true,
            data: {
              criteria,
              product,
              total_users: totalUsers,
              segments: rows.map((r) => ({
                ...r,
                percent_of_total:
                  totalUsers > 0
                    ? Math.round((Number(r.user_count) / totalUsers) * 10000) / 100
                    : 0,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `User segmentation failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
