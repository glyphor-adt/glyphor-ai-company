/**
 * Ops Extension Tools — Operations & Global Admin tooling
 *
 * Atlas Vega (ops) tools:
 *   get_agent_health_dashboard — Comprehensive agent health view
 *   get_event_bus_health       — Monitor event bus metrics
 *   get_data_freshness         — Check data sync staleness
 *   get_system_costs_realtime  — Real-time cost tracking
 *   create_status_report       — Generate system status report
 *   predict_capacity           — Forecast capacity needs
 *
 * Morgan Blake (global-admin) tools:
 *   get_access_matrix          — Full access matrix
 *   provision_access           — Grant platform access
 *   revoke_access              — Revoke access
 *   audit_access               — Run access audit
 *   rotate_secrets             — Trigger secret rotation
 *   get_platform_audit_log     — View platform actions
 */

import type { PredictionJournalRecord, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

function addDaysIso(base: Date, daysAhead: number): string {
  const target = new Date(base);
  target.setUTCDate(target.getUTCDate() + daysAhead);
  return target.toISOString();
}

export function createOpsExtensionTools(): ToolDefinition[] {
  return [
    // ── 1. get_agent_health_dashboard ───────────────────────────────────
    {
      name: 'get_agent_health_dashboard',
      description:
        'Comprehensive agent health view. Shows last run time, success rate, error count, ' +
        'and average cost for each agent over the last 24 hours. Optionally filter by department.',
      parameters: {
        department: {
          type: 'string',
          description: 'Optional department filter (e.g., "engineering", "marketing")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const department = params.department as string | undefined;

        try {
          let query = `
            SELECT ar.agent_id AS agent_role,
                   MAX(ar.started_at) AS last_run,
                   COUNT(*) AS total_runs,
                   COUNT(CASE WHEN ar.status = 'completed' THEN 1 END) AS success_count,
                   COUNT(CASE WHEN ar.status IN ('failed', 'error') THEN 1 END) AS error_count,
                   ROUND(AVG(COALESCE(ar.total_cost_usd, ar.cost, 0))::numeric, 4) AS avg_cost
            FROM agent_runs ar`;
          const queryParams: unknown[] = [];

          if (department) {
            query += ` JOIN company_agents ca ON ca.role = ar.agent_id
            WHERE ar.started_at >= NOW() - INTERVAL '24 hours'
              AND ca.department = $1`;
            queryParams.push(department);
          } else {
            query += ` WHERE ar.started_at >= NOW() - INTERVAL '24 hours'`;
          }

          query += ` GROUP BY ar.agent_id ORDER BY error_count DESC, ar.agent_id`;

          const rows = await systemQuery<{
            agent_role: string;
            last_run: string;
            total_runs: number;
            success_count: number;
            error_count: number;
            avg_cost: number;
          }>(query, queryParams);

          const grid = rows.map((r) => ({
            agent_role: r.agent_role,
            last_run: r.last_run,
            total_runs: Number(r.total_runs),
            success_rate: Number(r.total_runs) > 0
              ? Math.round((Number(r.success_count) / Number(r.total_runs)) * 1000) / 10
              : 0,
            error_count: Number(r.error_count),
            avg_cost: Number(r.avg_cost),
          }));

          return {
            success: true,
            data: {
              period: 'last_24h',
              department: department ?? 'all',
              agent_count: grid.length,
              total_errors: grid.reduce((s, g) => s + g.error_count, 0),
              agents: grid,
            },
          };
        } catch (err) {
          return { success: false, error: `Agent health query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 2. get_event_bus_health ─────────────────────────────────────────
    {
      name: 'get_event_bus_health',
      description:
        'Monitor event bus health. Returns event volume, processing stats, and recent ' +
        'event type distribution from the activity log.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const volume = await systemQuery<{ total_events: number; earliest: string; latest: string }>(
            `SELECT COUNT(*) AS total_events,
                    MIN(created_at) AS earliest,
                    MAX(created_at) AS latest
             FROM activity_log
             WHERE created_at >= NOW() - INTERVAL '1 hour'`,
          );

          const byType = await systemQuery<{ event_type: string; event_count: number }>(
            `SELECT action AS event_type, COUNT(*) AS event_count
             FROM activity_log
             WHERE created_at >= NOW() - INTERVAL '1 hour'
             GROUP BY action
             ORDER BY event_count DESC`,
          );

          const hourly = await systemQuery<{ hour: string; event_count: number }>(
            `SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*) AS event_count
             FROM activity_log
             WHERE created_at >= NOW() - INTERVAL '24 hours'
             GROUP BY DATE_TRUNC('hour', created_at)
             ORDER BY hour DESC
             LIMIT 24`,
          );

          const totalEvents = volume.length > 0 ? Number(volume[0].total_events) : 0;

          return {
            success: true,
            data: {
              last_hour: {
                total_events: totalEvents,
                earliest: volume.length > 0 ? volume[0].earliest : null,
                latest: volume.length > 0 ? volume[0].latest : null,
              },
              event_type_distribution: byType,
              hourly_trend: hourly,
            },
          };
        } catch (err) {
          return { success: false, error: `Event bus health query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 3. get_data_freshness ──────────────────────────────────────────
    {
      name: 'get_data_freshness',
      description:
        'Check data sync staleness. Returns each sync id (stripe, mercury, gcp-billing, …), last success time, last failure time, ' +
        'and data age from the data_sync_status table.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          // Schema: data_sync_status(id, last_success_at, last_failure_at, last_error, status, updated_at, …)
          const syncs = await systemQuery<{
            sync_name: string;
            last_success: string | null;
            last_failure: string | null;
            last_run: string | null;
            status: string;
          }>(
            `SELECT id AS sync_name,
                    last_success_at AS last_success,
                    last_failure_at AS last_failure,
                    updated_at AS last_run,
                    status
             FROM data_sync_status
             ORDER BY updated_at DESC NULLS LAST`,
          );

          const now = new Date();
          const results = syncs.map((s) => {
            const lastSuccess = s.last_success ? new Date(s.last_success) : null;
            const ageMinutes = lastSuccess
              ? Math.round((now.getTime() - lastSuccess.getTime()) / 60000)
              : null;

            return {
              sync_name: s.sync_name,
              status: s.status,
              last_success: s.last_success,
              last_failure: s.last_failure,
              data_age_minutes: ageMinutes,
              stale: ageMinutes !== null && ageMinutes > 60,
            };
          });

          const staleCount = results.filter((r) => r.stale).length;

          return {
            success: true,
            data: {
              total_syncs: results.length,
              stale_count: staleCount,
              syncs: results,
            },
          };
        } catch (err) {
          return { success: false, error: `Data freshness query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 4. get_system_costs_realtime ───────────────────────────────────
    {
      name: 'get_system_costs_realtime',
      description:
        'Real-time cost tracking for today. Returns today\'s spend grouped by agent role ' +
        'and model, plus projected daily total based on current run rate.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const byRole = await systemQuery<{ agent_role: string; total_cost: number; run_count: number }>(
            `SELECT agent_id AS agent_role, SUM(COALESCE(total_cost_usd, cost, 0)) AS total_cost, COUNT(*) AS run_count
             FROM agent_runs
             WHERE started_at >= DATE_TRUNC('day', NOW())
             GROUP BY agent_id
             ORDER BY total_cost DESC`,
          );

          const byModel = await systemQuery<{ model: string; total_cost: number; run_count: number }>(
            `SELECT COALESCE(model_used, 'unknown') AS model, SUM(COALESCE(total_cost_usd, cost, 0)) AS total_cost, COUNT(*) AS run_count
             FROM agent_runs
             WHERE started_at >= DATE_TRUNC('day', NOW())
             GROUP BY COALESCE(model_used, 'unknown')
             ORDER BY total_cost DESC`,
          );

          const todaySpend = byRole.reduce((s, r) => s + Number(r.total_cost), 0);
          const now = new Date();
          const hoursElapsed = now.getHours() + now.getMinutes() / 60;
          const projectedDaily = hoursElapsed > 0
            ? Math.round((todaySpend / hoursElapsed) * 24 * 100) / 100
            : 0;

          return {
            success: true,
            data: {
              today_spend: Math.round(todaySpend * 100) / 100,
              projected_daily_total: projectedDaily,
              hours_elapsed: Math.round(hoursElapsed * 10) / 10,
              by_agent_role: byRole,
              by_model: byModel,
            },
          };
        } catch (err) {
          return { success: false, error: `Realtime cost query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 5. create_status_report ────────────────────────────────────────
    {
      name: 'create_status_report',
      description:
        'Generate a structured system status report. Queries agent_runs, data_sync_status, ' +
        'and activity_log to compile a morning, evening, or incident report.',
      parameters: {
        report_type: {
          type: 'string',
          description: 'Type of status report to generate',
          required: true,
          enum: ['morning', 'evening', 'incident'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const reportType = params.report_type as string;
        const lookbackHours = reportType === 'incident' ? 4 : 24;

        try {
          const agentSummary = await systemQuery<{
            total_runs: number;
            success_count: number;
            error_count: number;
            total_cost: number;
          }>(
            `SELECT COUNT(*) AS total_runs,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) AS success_count,
                    COUNT(CASE WHEN status IN ('failed', 'error') THEN 1 END) AS error_count,
                    COALESCE(SUM(cost_usd), 0) AS total_cost
             FROM agent_runs
             WHERE started_at >= NOW() - INTERVAL '${lookbackHours} hours'`,
          );

          const syncStatus = await systemQuery<{
            sync_name: string;
            status: string;
            last_success: string | null;
          }>(
            `SELECT id AS sync_name, status, last_success_at AS last_success
             FROM data_sync_status
             ORDER BY updated_at DESC NULLS LAST`,
          );

          const recentEvents = await systemQuery<{ event_type: string; event_count: number }>(
            `SELECT event_type, COUNT(*) AS event_count
             FROM activity_log
             WHERE created_at >= NOW() - INTERVAL '${lookbackHours} hours'
             GROUP BY event_type
             ORDER BY event_count DESC
             LIMIT 10`,
          );

          const summary = agentSummary.length > 0 ? agentSummary[0] : {
            total_runs: 0, success_count: 0, error_count: 0, total_cost: 0,
          };
          const failedSyncs = syncStatus.filter((s) => s.status === 'failed' || s.status === 'error');

          return {
            success: true,
            data: {
              report_type: reportType,
              generated_at: new Date().toISOString(),
              lookback_hours: lookbackHours,
              agent_health: {
                total_runs: Number(summary.total_runs),
                success_count: Number(summary.success_count),
                error_count: Number(summary.error_count),
                success_rate: Number(summary.total_runs) > 0
                  ? Math.round((Number(summary.success_count) / Number(summary.total_runs)) * 1000) / 10
                  : 0,
                total_cost: Math.round(Number(summary.total_cost) * 100) / 100,
              },
              data_syncs: {
                total: syncStatus.length,
                failed: failedSyncs.length,
                failed_syncs: failedSyncs.map((s) => s.sync_name),
              },
              recent_events: recentEvents,
            },
          };
        } catch (err) {
          return { success: false, error: `Status report generation failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 6. predict_capacity ────────────────────────────────────────────
    {
      name: 'predict_capacity',
      description:
        'Forecast capacity needs by analyzing agent run trends and extrapolating. ' +
        'Returns projected runs, costs, and scaling recommendations.',
      parameters: {
        days_ahead: {
          type: 'number',
          description: 'Number of days to forecast (default: 30)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const daysAhead = (params.days_ahead as number) || 30;

        try {
          const dailyTrend = await systemQuery<{ day: string; run_count: number; daily_cost: number }>(
            `SELECT DATE(started_at) AS day,
                    COUNT(*) AS run_count,
                    COALESCE(SUM(cost_usd), 0) AS daily_cost
             FROM agent_runs
             WHERE started_at >= NOW() - INTERVAL '30 days'
             GROUP BY DATE(started_at)
             ORDER BY day`,
          );

          if (dailyTrend.length < 3) {
            return { success: true, data: { message: 'Insufficient data for capacity prediction', days_available: dailyTrend.length } };
          }

          const runs = dailyTrend.map((d) => Number(d.run_count));
          const costs = dailyTrend.map((d) => Number(d.daily_cost));

          const avgRuns = runs.reduce((s, v) => s + v, 0) / runs.length;
          const avgCost = costs.reduce((s, v) => s + v, 0) / costs.length;

          // Simple linear trend (slope over the window)
          const n = runs.length;
          const xMean = (n - 1) / 2;
          const runSlope = runs.reduce((s, v, i) => s + (i - xMean) * (v - avgRuns), 0)
            / runs.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
          const costSlope = costs.reduce((s, v, i) => s + (i - xMean) * (v - avgCost), 0)
            / costs.reduce((s, _, i) => s + (i - xMean) ** 2, 0);

          const projectedDailyRuns = Math.round(avgRuns + runSlope * daysAhead);
          const projectedDailyCost = Math.round((avgCost + costSlope * daysAhead) * 100) / 100;
          const projectedTotalCost = Math.round(projectedDailyCost * daysAhead * 100) / 100;

          const trendDirection = runSlope > 0.5 ? 'increasing' : runSlope < -0.5 ? 'decreasing' : 'stable';
          const targetDate = addDaysIso(new Date(), daysAhead);
          const predictions: PredictionJournalRecord[] = [
            {
              prediction_type: 'capacity_daily_runs',
              predicted_value: {
                projected_daily_runs: projectedDailyRuns,
                trend: trendDirection,
                forecast_days: daysAhead,
              },
              target_date: targetDate,
              resolution_source: 'agent_runs_daily_runs',
            },
            {
              prediction_type: 'capacity_daily_cost',
              predicted_value: {
                projected_daily_cost: projectedDailyCost,
                projected_total_cost: projectedTotalCost,
                trend: trendDirection,
                forecast_days: daysAhead,
              },
              target_date: targetDate,
              resolution_source: 'agent_runs_daily_cost',
            },
          ];

          return {
            success: true,
            data: {
              forecast_days: daysAhead,
              historical_days: n,
              current_avg_daily_runs: Math.round(avgRuns),
              current_avg_daily_cost: Math.round(avgCost * 100) / 100,
              projected_daily_runs: projectedDailyRuns,
              projected_daily_cost: projectedDailyCost,
              projected_total_cost: projectedTotalCost,
              trend: trendDirection,
              scaling_recommendation: projectedDailyRuns > avgRuns * 1.5
                ? 'Consider scaling up — projected demand exceeds current baseline by 50%+'
                : projectedDailyRuns < avgRuns * 0.5
                  ? 'Consider scaling down — projected demand is below 50% of current baseline'
                  : 'Current capacity appears sufficient',
              predictions,
            },
          };
        } catch (err) {
          return { success: false, error: `Capacity prediction failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 7. get_access_matrix ───────────────────────────────────────────
    {
      name: 'get_access_matrix',
      description:
        'Full access matrix showing who has access to what platform with permission levels. ' +
        'Optionally filter by platform.',
      parameters: {
        platform: {
          type: 'string',
          description: 'Optional platform filter (e.g., "gcp", "github", "stripe")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string | undefined;

        try {
          let query = `SELECT agent_role,
                              platform,
                              credential_id,
                              permissions,
                              last_synced AS last_verified,
                              CASE WHEN in_sync THEN 'in_sync' ELSE 'drift' END AS status,
                              drift_details
                       FROM platform_iam_state`;
          const queryParams: unknown[] = [];

          if (platform) {
            query += ` WHERE platform = $1`;
            queryParams.push(platform);
          }

          query += ` ORDER BY platform, agent_role`;

          const rows = await systemQuery<{
            agent_role: string | null;
            platform: string;
            credential_id: string;
            permissions: unknown;
            last_verified: string | null;
            status: string;
            drift_details: string | null;
          }>(query, queryParams);

          const permText = (p: unknown): string =>
            typeof p === 'string' ? p : p != null ? JSON.stringify(p) : '';

          // Group by platform
          const byPlatform: Record<
            string,
            {
              agent_role: string | null;
              credential_id: string;
              permissions: string;
              last_verified: string | null;
              status: string;
              drift_details: string | null;
            }[]
          > = {};
          for (const row of rows) {
            if (!byPlatform[row.platform]) byPlatform[row.platform] = [];
            byPlatform[row.platform].push({
              agent_role: row.agent_role,
              credential_id: row.credential_id,
              permissions: permText(row.permissions),
              last_verified: row.last_verified,
              status: row.status,
              drift_details: row.drift_details,
            });
          }

          return {
            success: true,
            data: {
              total_entries: rows.length,
              platform_count: Object.keys(byPlatform).length,
              platform: platform ?? 'all',
              matrix: byPlatform,
            },
          };
        } catch (err) {
          return { success: false, error: `Access matrix query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 8. provision_access ────────────────────────────────────────────
    {
      name: 'provision_access',
      description:
        'Grant platform access to an agent role. Logs the provisioning action to the activity log.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to grant access to (e.g., "cto", "head-of-marketing")',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Platform to grant access to (e.g., "gcp", "github", "stripe")',
          required: true,
        },
        permissions: {
          type: 'string',
          description: 'Permission level to grant (e.g., "read", "write", "admin")',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Business justification for granting access',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const platform = params.platform as string;
        const permissions = params.permissions as string;
        const justification = params.justification as string;

        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [
              agentRole,
              'access_provisioned',
              `Provisioned ${platform} access for ${agentRole}`,
              JSON.stringify({ permissions, justification, platform }),
            ],
          );

          return {
            success: true,
            data: {
              action: 'access_provisioned',
              agent_role: agentRole,
              platform,
              permissions,
              justification,
              provisioned_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Access provisioning failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 9. revoke_access ───────────────────────────────────────────────
    {
      name: 'revoke_access',
      description:
        'Revoke platform access from an agent role. Logs the revocation to the activity log.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to revoke access from',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Platform to revoke access from',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Reason for revoking access',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const platform = params.platform as string;
        const reason = (params.reason as string) ?? 'No reason provided';

        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [
              agentRole,
              'access_revoked',
              `Revoked ${platform} access for ${agentRole}`,
              JSON.stringify({ reason, platform }),
            ],
          );

          return {
            success: true,
            data: {
              action: 'access_revoked',
              agent_role: agentRole,
              platform,
              reason,
              revoked_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Access revocation failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 10. audit_access ───────────────────────────────────────────────
    {
      name: 'audit_access',
      description:
        'Run an access audit. Checks platform_iam_state for stale credentials and ' +
        'over-provisioned accounts. Returns audit findings.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const staleCredentials = await systemQuery<{
            agent_role: string;
            platform: string;
            last_verified: string;
            status: string;
          }>(
            `SELECT agent_role, platform, last_verified, status
             FROM platform_iam_state
             WHERE last_verified < NOW() - INTERVAL '90 days'
                OR status = 'inactive'
             ORDER BY last_verified ASC`,
          );

          const adminAccounts = await systemQuery<{
            agent_role: string;
            platform: string;
            permissions: string;
          }>(
            `SELECT agent_role, platform, permissions
             FROM platform_iam_state
             WHERE permissions ILIKE '%admin%' OR permissions ILIKE '%owner%'
             ORDER BY platform, agent_role`,
          );

          const allAccounts = await systemQuery<{ total: number }>(
            `SELECT COUNT(*) AS total FROM platform_iam_state`,
          );

          const totalAccounts = allAccounts.length > 0 ? Number(allAccounts[0].total) : 0;

          return {
            success: true,
            data: {
              audit_date: new Date().toISOString(),
              total_accounts: totalAccounts,
              findings: {
                stale_credentials: {
                  count: staleCredentials.length,
                  entries: staleCredentials,
                },
                elevated_access: {
                  count: adminAccounts.length,
                  entries: adminAccounts,
                },
              },
              recommendations: [
                ...(staleCredentials.length > 0
                  ? [`Review ${staleCredentials.length} stale credential(s) not verified in 90+ days`]
                  : []),
                ...(adminAccounts.length > 3
                  ? [`${adminAccounts.length} accounts have admin/owner access — consider reducing`]
                  : []),
              ],
            },
          };
        } catch (err) {
          return { success: false, error: `Access audit failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 11. rotate_secrets ─────────────────────────────────────────────
    {
      name: 'rotate_secrets',
      description:
        'Trigger secret rotation for a platform. Queries platform_secret_rotation for current ' +
        'rotation state and logs the rotation action to the activity log.',
      parameters: {
        platform: {
          type: 'string',
          description: 'Platform whose secret to rotate (e.g., "gcp", "github", "stripe")',
          required: true,
        },
        secret_name: {
          type: 'string',
          description: 'Name of the secret to rotate (e.g., "api_key", "service_account")',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string;
        const secretName = params.secret_name as string;

        try {
          const current = await systemQuery<{
            last_rotated: string;
            rotation_interval_days: number;
            status: string;
          }>(
            `SELECT last_rotated, rotation_interval_days, status
             FROM platform_secret_rotation
             WHERE platform = $1 AND secret_name = $2
             LIMIT 1`,
            [platform, secretName],
          );

          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [
              'global-admin',
              'secret_rotation',
              `Secret rotation triggered for ${platform}/${secretName}`,
              JSON.stringify({ secret_name: secretName, triggered_at: new Date().toISOString(), platform }),
            ],
          );

          return {
            success: true,
            data: {
              action: 'secret_rotation',
              platform,
              secret_name: secretName,
              previous_rotation: current.length > 0 ? current[0].last_rotated : 'unknown',
              rotation_interval_days: current.length > 0 ? current[0].rotation_interval_days : null,
              current_status: current.length > 0 ? current[0].status : 'not_found',
              triggered_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Secret rotation failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 12. get_platform_audit_log ─────────────────────────────────────
    {
      name: 'get_platform_audit_log',
      description:
        'View platform audit records with structured Microsoft write visibility. Filter by platform, ' +
        'date range, agent role, action, identity type, fallback flag, and outcome.',
      parameters: {
        platform: {
          type: 'string',
          description: 'Optional platform filter',
          required: false,
        },
        date_range: {
          type: 'string',
          description: 'Time period to query',
          enum: ['7d', '30d', '90d'],
          required: false,
        },
        agent_role: {
          type: 'string',
          description: 'Optional agent role filter',
          required: false,
        },
        action: {
          type: 'string',
          description: 'Optional action filter (for example: teams.channel_post.text, calendar.create_event)',
          required: false,
        },
        identity_type: {
          type: 'string',
          description: 'Optional Microsoft identity type filter (agent365, webhook-bot, delegated-graph, app-only-graph)',
          required: false,
        },
        fallback_used: {
          type: 'boolean',
          description: 'Optional filter for whether a write used a fallback path',
          required: false,
        },
        outcome: {
          type: 'string',
          description: 'Optional outcome filter',
          enum: ['success', 'failure'],
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string | undefined;
        const dateRange = (params.date_range as string) || '30d';
        const agentRole = params.agent_role as string | undefined;
        const action = params.action as string | undefined;
        const identityType = params.identity_type as string | undefined;
        const fallbackUsed = typeof params.fallback_used === 'boolean' ? params.fallback_used : undefined;
        const outcome = params.outcome as string | undefined;
        const days = dateRange === '7d' ? 7 : dateRange === '90d' ? 90 : 30;

        try {
          const useMicrosoftView = platform === 'microsoft'
            || identityType !== undefined
            || fallbackUsed !== undefined
            || outcome !== undefined;
          let query = useMicrosoftView
            ? `SELECT
                 timestamp,
                 agent_role,
                 action,
                 resource,
                 identity_type,
                 fallback_used,
                 tenant_id,
                 workspace_key,
                 approval_id,
                 approval_reference,
                 outcome,
                 tool_name,
                 target_type,
                 target_id,
                 limitation,
                 response_code,
                 response_summary
               FROM microsoft_write_audit_view
               WHERE timestamp >= NOW() - INTERVAL '${days} days'`
            : `SELECT
                 timestamp,
                 agent_role,
                 action,
                 resource,
                 NULL::text AS identity_type,
                 NULL::boolean AS fallback_used,
                 NULL::text AS tenant_id,
                 NULL::text AS workspace_key,
                 NULL::text AS approval_id,
                 NULL::text AS approval_reference,
                 NULL::text AS outcome,
                 NULL::text AS tool_name,
                 NULL::text AS target_type,
                 NULL::text AS target_id,
                 NULL::text AS limitation,
                 response_code,
                 response_summary
               FROM platform_audit_log
               WHERE timestamp >= NOW() - INTERVAL '${days} days'`;
          const queryParams: unknown[] = [];
          let paramIdx = 1;

          if (platform && !useMicrosoftView) {
            query += ` AND platform = $${paramIdx++}`;
            queryParams.push(platform);
          }
          if (agentRole) {
            query += ` AND agent_role = $${paramIdx++}`;
            queryParams.push(agentRole);
          }
          if (action) {
            query += ` AND action = $${paramIdx++}`;
            queryParams.push(action);
          }
          if (useMicrosoftView && identityType) {
            query += ` AND identity_type = $${paramIdx++}`;
            queryParams.push(identityType);
          }
          if (useMicrosoftView && fallbackUsed !== undefined) {
            query += ` AND fallback_used = $${paramIdx++}`;
            queryParams.push(fallbackUsed);
          }
          if (useMicrosoftView && outcome) {
            query += ` AND outcome = $${paramIdx++}`;
            queryParams.push(outcome);
          }

          query += ` ORDER BY created_at DESC LIMIT 100`;
          query = query.replace(/created_at DESC/, 'timestamp DESC');

          const rows = await systemQuery<{
            timestamp: string;
            agent_role: string;
            action: string;
            resource: string | null;
            identity_type: string | null;
            fallback_used: boolean | null;
            tenant_id: string | null;
            workspace_key: string | null;
            approval_id: string | null;
            approval_reference: string | null;
            outcome: string | null;
            tool_name: string | null;
            target_type: string | null;
            target_id: string | null;
            limitation: string | null;
            response_code: number | null;
            response_summary: string | null;
          }>(query, queryParams);

          return {
            success: true,
            data: {
              date_range: dateRange,
              platform: platform ?? (useMicrosoftView ? 'microsoft' : 'all'),
              agent_role: agentRole ?? 'all',
              action: action ?? 'all',
              identity_type: identityType ?? 'all',
              fallback_used: fallbackUsed ?? 'all',
              outcome: outcome ?? 'all',
              total_entries: rows.length,
              entries: rows,
            },
          };
        } catch (err) {
          return { success: false, error: `Platform audit log query failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
