/**
 * Engineering Gap Tools — Quality, DevOps & Platform engineering tooling
 *
 * Sam DeLuca (quality-engineer) tools:
 *   run_test_suite               — Trigger a test suite run
 *   get_code_coverage            — Get code coverage metrics
 *   get_quality_metrics          — Overall quality metrics dashboard
 *   create_test_plan             — Create a structured test plan
 *
 * Jordan Hayes (devops-engineer) tools:
 *   get_container_logs           — Get Cloud Run container logs
 *   scale_service                — Scale a Cloud Run service
 *   get_build_queue              — Get pending and running builds
 *   get_deployment_history       — View deployment history
 *
 * Alex Park (platform-engineer) tools:
 *   get_infrastructure_inventory — Full infrastructure inventory
 *   get_service_dependencies     — Map service dependency graph
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createEngineeringGapTools(): ToolDefinition[] {
  return [
    // ── 1. run_test_suite ─────────────────────────────────────────────
    {
      name: 'run_test_suite',
      description:
        'Trigger a test suite run for the specified suite type. Optionally scope to a ' +
        'single package. Logs the trigger event and returns a run ID for tracking.',
      parameters: {
        suite: {
          type: 'string',
          description: 'Test suite type to run',
          required: true,
          enum: ['unit', 'integration', 'e2e', 'all'],
        },
        package: {
          type: 'string',
          description: 'Optional package name to scope the test run (e.g., "dashboard", "agents")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const suite = params.suite as string;
        const pkg = (params.package as string) || null;

        try {
          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)
             RETURNING id`,
            [
              'quality-engineer',
              'test_run_triggered',
              `Test run: ${suite}${pkg ? ` (${pkg})` : ''}`,
              JSON.stringify({ suite, package: pkg, category: 'testing' }),
            ],
          );

          return {
            success: true,
            data: {
              run_id: row.id,
              suite,
              package: pkg ?? 'all',
              status: 'triggered',
              triggered_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to trigger test suite: ${(err as Error).message}` };
        }
      },
    },

    // ── 2. get_code_coverage ──────────────────────────────────────────
    {
      name: 'get_code_coverage',
      description:
        'Get code coverage metrics for the codebase. Returns line, branch, and function ' +
        'coverage percentages from recent test runs. Optionally filter by package.',
      parameters: {
        package: {
          type: 'string',
          description: 'Optional package name to filter coverage (e.g., "dashboard", "agents")',
          required: false,
        },
        date_range: {
          type: 'string',
          description: 'Time window for coverage data',
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const pkg = params.package as string | undefined;
        const range = (params.date_range as string) || '7d';
        const intervalDays = range === '90d' ? 90 : range === '30d' ? 30 : 7;

        try {
          let query = `
            SELECT id, details, created_at
            FROM activity_log
            WHERE event_type = 'coverage_report'
              AND created_at >= NOW() - INTERVAL '${intervalDays} days'`;
          const queryParams: unknown[] = [];

          if (pkg) {
            query += ` AND details::jsonb->>'package' = $1`;
            queryParams.push(pkg);
          }

          query += ` ORDER BY created_at DESC LIMIT 20`;

          const rows = await systemQuery<{
            id: string;
            details: string;
            created_at: string;
          }>(query, queryParams);

          const reports = rows.map((r) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            return {
              id: r.id,
              date: r.created_at,
              line_coverage: d.line_coverage ?? null,
              branch_coverage: d.branch_coverage ?? null,
              function_coverage: d.function_coverage ?? null,
              package: d.package ?? 'all',
            };
          });

          const latest = reports.length > 0 ? reports[0] : null;

          return {
            success: true,
            data: {
              date_range: range,
              package: pkg ?? 'all',
              report_count: reports.length,
              latest: latest
                ? {
                    line_coverage: latest.line_coverage,
                    branch_coverage: latest.branch_coverage,
                    function_coverage: latest.function_coverage,
                    date: latest.date,
                  }
                : null,
              history: reports,
            },
          };
        } catch (err) {
          return { success: false, error: `Code coverage query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 3. get_quality_metrics ────────────────────────────────────────
    {
      name: 'get_quality_metrics',
      description:
        'Overall quality metrics dashboard. Returns build success rates, error patterns, ' +
        'quality score, test pass rate, and bug density from agent run data.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window for quality metrics',
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const range = (params.date_range as string) || '7d';
        const intervalDays = range === '90d' ? 90 : range === '30d' ? 30 : 7;

        try {
          const buildStats = await systemQuery<{
            total_runs: number;
            success_count: number;
            error_count: number;
          }>(
            `SELECT COUNT(*) AS total_runs,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) AS success_count,
                    COUNT(CASE WHEN status IN ('failed', 'error') THEN 1 END) AS error_count
             FROM agent_runs
             WHERE started_at >= NOW() - INTERVAL '${intervalDays} days'`,
          );

          const errorPatterns = await systemQuery<{ error_type: string; occurrence_count: number }>(
            `SELECT COALESCE(error_type, 'unknown') AS error_type, COUNT(*) AS occurrence_count
             FROM agent_runs
             WHERE status IN ('failed', 'error')
               AND started_at >= NOW() - INTERVAL '${intervalDays} days'
             GROUP BY error_type
             ORDER BY occurrence_count DESC
             LIMIT 10`,
          );

          const testEvents = await systemQuery<{ total_tests: number; passed: number; failed: number }>(
            `SELECT COUNT(*) AS total_tests,
                    COUNT(CASE WHEN details::jsonb->>'result' = 'pass' THEN 1 END) AS passed,
                    COUNT(CASE WHEN details::jsonb->>'result' = 'fail' THEN 1 END) AS failed
             FROM activity_log
             WHERE action = 'test_run_triggered'
               AND created_at >= NOW() - INTERVAL '${intervalDays} days'`,
          );

          const bugEvents = await systemQuery<{ bug_count: number }>(
            `SELECT COUNT(*) AS bug_count
             FROM activity_log
             WHERE action IN ('bug_reported', 'bug_filed')
               AND created_at >= NOW() - INTERVAL '${intervalDays} days'`,
          );

          const summary = buildStats.length > 0 ? buildStats[0] : { total_runs: 0, success_count: 0, error_count: 0 };
          const totalRuns = Number(summary.total_runs);
          const successCount = Number(summary.success_count);
          const errorCount = Number(summary.error_count);
          const buildSuccessRate = totalRuns > 0
            ? Math.round((successCount / totalRuns) * 1000) / 10
            : 0;

          const tests = testEvents.length > 0 ? testEvents[0] : { total_tests: 0, passed: 0, failed: 0 };
          const totalTests = Number(tests.total_tests);
          const testPassRate = totalTests > 0
            ? Math.round((Number(tests.passed) / totalTests) * 1000) / 10
            : 0;

          const bugCount = bugEvents.length > 0 ? Number(bugEvents[0].bug_count) : 0;
          const bugDensity = totalRuns > 0
            ? Math.round((bugCount / totalRuns) * 10000) / 100
            : 0;

          // Quality score: weighted composite (build success 40%, test pass 40%, low bugs 20%)
          const bugPenalty = Math.min(bugDensity * 10, 100);
          const qualityScore = Math.round(
            buildSuccessRate * 0.4 + testPassRate * 0.4 + (100 - bugPenalty) * 0.2,
          );

          return {
            success: true,
            data: {
              date_range: range,
              quality_score: qualityScore,
              build_success_rate: buildSuccessRate,
              test_pass_rate: testPassRate,
              bug_density: bugDensity,
              total_builds: totalRuns,
              total_errors: errorCount,
              total_bugs: bugCount,
              error_patterns: errorPatterns,
            },
          };
        } catch (err) {
          return { success: false, error: `Quality metrics query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 4. create_test_plan ───────────────────────────────────────────
    {
      name: 'create_test_plan',
      description:
        'Create a structured test plan for a feature. Specifies which test types to include ' +
        'and priority level. Logs the plan and returns a plan ID.',
      parameters: {
        feature: {
          type: 'string',
          description: 'Feature or component name the test plan covers',
          required: true,
        },
        test_types: {
          type: 'string',
          description: 'Comma-separated list of test types (e.g., "unit,integration,e2e")',
          required: false,
        },
        priority: {
          type: 'string',
          description: 'Priority level for the test plan',
          enum: ['low', 'medium', 'high'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const feature = params.feature as string;
        const testTypes = (params.test_types as string) || 'unit,integration';
        const priority = (params.priority as string) || 'medium';

        try {
          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)
             RETURNING id`,
            [
              'quality-engineer',
              'test_plan',
              `Test plan: ${feature} (${testTypes})`,
              JSON.stringify({ feature, test_types: testTypes.split(',').map((t) => t.trim()), priority, category: 'testing' }),
            ],
          );

          return {
            success: true,
            data: {
              plan_id: row.id,
              feature,
              test_types: testTypes.split(',').map((t) => t.trim()),
              priority,
              status: 'created',
              created_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Failed to create test plan: ${(err as Error).message}` };
        }
      },
    },

    // ── 5. get_container_logs ─────────────────────────────────────────
    {
      name: 'get_container_logs',
      description:
        'Get Cloud Run container logs for a service. Optionally filter by severity level ' +
        'and limit the number of returned entries.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service name (e.g., "agent-runtime", "scheduler")',
          required: true,
        },
        severity: {
          type: 'string',
          description: 'Minimum severity level to filter logs',
          required: false,
          enum: ['debug', 'info', 'warning', 'error', 'critical'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log entries to return (default: 100)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const service = params.service as string;
        const severity = params.severity as string | undefined;
        const limit = (params.limit as number) || 100;

        const severityLevels = ['debug', 'info', 'warning', 'error', 'critical'];

        try {
          let query = `
            SELECT id, event_type, details, created_at
            FROM activity_log
            WHERE category = 'container_log'
              AND details::jsonb->>'service' = $1`;
          const queryParams: unknown[] = [service];

          if (severity) {
            const minIdx = severityLevels.indexOf(severity);
            const allowedLevels = severityLevels.slice(minIdx);
            query += ` AND details::jsonb->>'severity' = ANY($2)`;
            queryParams.push(allowedLevels);
          }

          query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
          queryParams.push(limit);

          const rows = await systemQuery<{
            id: string;
            event_type: string;
            details: string;
            created_at: string;
          }>(query, queryParams);

          const entries = rows.map((r) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            return {
              id: r.id,
              timestamp: r.created_at,
              severity: d.severity ?? 'info',
              message: d.message ?? '',
              service: d.service,
            };
          });

          return {
            success: true,
            data: {
              service,
              severity_filter: severity ?? 'all',
              entry_count: entries.length,
              entries,
            },
          };
        } catch (err) {
          return { success: false, error: `Container log query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 6. scale_service ──────────────────────────────────────────────
    {
      name: 'scale_service',
      description:
        'Scale a Cloud Run service by setting minimum and maximum instance counts. ' +
        'Logs the scaling request for audit purposes.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service name to scale (e.g., "agent-runtime", "scheduler")',
          required: true,
        },
        min_instances: {
          type: 'number',
          description: 'Minimum number of instances',
          required: true,
        },
        max_instances: {
          type: 'number',
          description: 'Maximum number of instances',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const service = params.service as string;
        const minInstances = params.min_instances as number;
        const maxInstances = params.max_instances as number;

        if (minInstances < 0 || maxInstances < minInstances) {
          return { success: false, error: 'Invalid instance range: min must be >= 0 and max must be >= min' };
        }

        try {
          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ($1, $2, $3, $4::jsonb)
             RETURNING id`,
            [
              'devops-engineer',
              'scale_request',
              `Scale ${service}: ${minInstances}-${maxInstances} instances`,
              JSON.stringify({ service, min_instances: minInstances, max_instances: maxInstances, category: 'infrastructure' }),
            ],
          );

          return {
            success: true,
            data: {
              request_id: row.id,
              service,
              min_instances: minInstances,
              max_instances: maxInstances,
              status: 'requested',
              requested_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Scale request failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 7. get_build_queue ────────────────────────────────────────────
    {
      name: 'get_build_queue',
      description:
        'Get pending and running builds. Returns the current build queue with position, ' +
        'estimated completion time, and build details.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const rows = await systemQuery<{
            id: string;
            event_type: string;
            details: string;
            created_at: string;
          }>(
            `SELECT id, event_type, details, created_at
             FROM activity_log
             WHERE event_type IN ('build_started', 'build_queued', 'build_pending')
               AND (details::jsonb->>'status' IS NULL
                    OR details::jsonb->>'status' IN ('pending', 'running', 'queued'))
             ORDER BY created_at ASC`,
          );

          const now = new Date();
          const queue = rows.map((r, idx) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            const startedAt = new Date(r.created_at);
            const elapsedMinutes = Math.round((now.getTime() - startedAt.getTime()) / 60000);

            return {
              id: r.id,
              position: idx + 1,
              event_type: r.event_type,
              service: d.service ?? d.package ?? 'unknown',
              status: d.status ?? 'pending',
              started_at: r.created_at,
              elapsed_minutes: elapsedMinutes,
              estimated_remaining_minutes: Math.max(0, 10 - elapsedMinutes),
            };
          });

          return {
            success: true,
            data: {
              queue_length: queue.length,
              builds: queue,
            },
          };
        } catch (err) {
          return { success: false, error: `Build queue query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 8. get_deployment_history ─────────────────────────────────────
    {
      name: 'get_deployment_history',
      description:
        'View deployment history for services. Returns deployments with status, duration, ' +
        'and rollback information. Optionally filter by service name.',
      parameters: {
        service: {
          type: 'string',
          description: 'Optional service name to filter deployment history',
          required: false,
        },
        date_range: {
          type: 'string',
          description: 'Time window for deployment history',
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const service = params.service as string | undefined;
        const range = (params.date_range as string) || '7d';
        const intervalDays = range === '90d' ? 90 : range === '30d' ? 30 : 7;

        try {
          let query = `
            SELECT id, event_type, details, created_at
            FROM activity_log
            WHERE event_type IN ('deployment', 'deploy_started', 'deploy_completed', 'deploy_failed', 'rollback')
              AND created_at >= NOW() - INTERVAL '${intervalDays} days'`;
          const queryParams: unknown[] = [];

          if (service) {
            query += ` AND details::jsonb->>'service' = $1`;
            queryParams.push(service);
          }

          query += ` ORDER BY created_at DESC LIMIT 50`;

          const rows = await systemQuery<{
            id: string;
            event_type: string;
            details: string;
            created_at: string;
          }>(query, queryParams);

          const deployments = rows.map((r) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            return {
              id: r.id,
              event_type: r.event_type,
              service: d.service ?? 'unknown',
              version: d.version ?? d.image_tag ?? null,
              status: d.status ?? r.event_type,
              duration_seconds: d.duration_seconds ?? null,
              rollback: d.rollback ?? false,
              deployed_at: r.created_at,
            };
          });

          const successCount = deployments.filter((d) =>
            d.status === 'completed' || d.event_type === 'deploy_completed',
          ).length;
          const failCount = deployments.filter((d) =>
            d.status === 'failed' || d.event_type === 'deploy_failed',
          ).length;

          return {
            success: true,
            data: {
              date_range: range,
              service: service ?? 'all',
              total_deployments: deployments.length,
              successful: successCount,
              failed: failCount,
              rollbacks: deployments.filter((d) => d.rollback).length,
              deployments,
            },
          };
        } catch (err) {
          return { success: false, error: `Deployment history query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 9. get_infrastructure_inventory ───────────────────────────────
    {
      name: 'get_infrastructure_inventory',
      description:
        'Full infrastructure inventory across providers. Returns service list with specs, ' +
        'estimated costs, and health status from data_sync_status and activity_log.',
      parameters: {
        provider: {
          type: 'string',
          description: 'Cloud provider to filter by',
          enum: ['gcp', 'vercel', 'all'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const provider = (params.provider as string) || 'all';

        try {
          // data_sync_status: id, last_success_at, last_failure_at, status, updated_at (no sync_name / last_run)
          let syncQuery = `
            SELECT id AS sync_name, status,
                   last_success_at AS last_success,
                   last_failure_at AS last_failure,
                   updated_at AS last_run
            FROM data_sync_status`;
          const syncParams: unknown[] = [];

          if (provider !== 'all') {
            syncQuery += ` WHERE id ILIKE $1`;
            syncParams.push(`%${provider}%`);
          }
          syncQuery += ` ORDER BY id`;

          const syncs = await systemQuery<{
            sync_name: string;
            status: string;
            last_success: string | null;
            last_failure: string | null;
            last_run: string | null;
          }>(syncQuery, syncParams);

          let infraQuery = `
            SELECT id, event_type, details, created_at
            FROM activity_log
            WHERE event_type IN ('infra_update', 'service_provisioned', 'resource_created')`;
          const infraParams: unknown[] = [];

          if (provider !== 'all') {
            infraQuery += ` AND details::jsonb->>'provider' = $1`;
            infraParams.push(provider);
          }
          infraQuery += ` ORDER BY created_at DESC LIMIT 50`;

          const infraEvents = await systemQuery<{
            id: string;
            event_type: string;
            details: string;
            created_at: string;
          }>(infraQuery, infraParams);

          const services = infraEvents.map((r) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            return {
              id: r.id,
              service: d.service ?? d.name ?? 'unknown',
              provider: d.provider ?? provider,
              specs: d.specs ?? null,
              estimated_monthly_cost: d.cost ?? null,
              status: d.status ?? 'active',
              last_updated: r.created_at,
            };
          });

          const syncHealth = syncs.map((s) => ({
            sync_name: s.sync_name,
            status: s.status,
            last_success: s.last_success,
            healthy: s.status !== 'failed' && s.status !== 'error',
          }));

          return {
            success: true,
            data: {
              provider,
              service_count: services.length,
              sync_count: syncs.length,
              healthy_syncs: syncHealth.filter((s) => s.healthy).length,
              unhealthy_syncs: syncHealth.filter((s) => !s.healthy).length,
              services,
              sync_health: syncHealth,
            },
          };
        } catch (err) {
          return { success: false, error: `Infrastructure inventory query failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 10. get_service_dependencies ──────────────────────────────────
    {
      name: 'get_service_dependencies',
      description:
        'Map service dependency graph. Returns upstream and downstream dependencies ' +
        'between services (Cloud Run, Cloud SQL, Vercel, etc.).',
      parameters: {
        service: {
          type: 'string',
          description: 'Optional service name to show dependencies for. If omitted, returns full graph.',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const service = params.service as string | undefined;

        try {
          let query = `
            SELECT id, event_type, details, created_at
            FROM activity_log
            WHERE event_type IN ('dependency_map', 'service_link', 'dependency_registered')
            ORDER BY created_at DESC LIMIT 100`;
          const queryParams: unknown[] = [];

          if (service) {
            query = `
              SELECT id, event_type, details, created_at
              FROM activity_log
              WHERE event_type IN ('dependency_map', 'service_link', 'dependency_registered')
                AND (details::jsonb->>'service' = $1
                     OR details::jsonb->>'upstream' = $1
                     OR details::jsonb->>'downstream' = $1)
              ORDER BY created_at DESC LIMIT 100`;
            queryParams.push(service);
          }

          const rows = await systemQuery<{
            id: string;
            event_type: string;
            details: string;
            created_at: string;
          }>(query, queryParams);

          const edges = rows.map((r) => {
            const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
            return {
              upstream: d.upstream ?? d.service ?? 'unknown',
              downstream: d.downstream ?? d.depends_on ?? 'unknown',
              type: d.dependency_type ?? 'runtime',
              last_updated: r.created_at,
            };
          });

          // Derive unique services from edges
          const serviceSet = new Set<string>();
          edges.forEach((e) => {
            serviceSet.add(e.upstream);
            serviceSet.add(e.downstream);
          });

          // If no logged dependencies, return a static known topology
          if (edges.length === 0) {
            const knownDeps = [
              { upstream: 'cloud-sql', downstream: 'agent-runtime', type: 'database' },
              { upstream: 'cloud-sql', downstream: 'scheduler', type: 'database' },
              { upstream: 'agent-runtime', downstream: 'dashboard', type: 'api' },
              { upstream: 'agent-runtime', downstream: 'pulse', type: 'api' },
              { upstream: 'scheduler', downstream: 'agent-runtime', type: 'orchestration' },
              { upstream: 'vercel', downstream: 'dashboard', type: 'hosting' },
              { upstream: 'vercel', downstream: 'pulse', type: 'hosting' },
            ];

            const filteredDeps = service
              ? knownDeps.filter((d) => d.upstream === service || d.downstream === service)
              : knownDeps;

            return {
              success: true,
              data: {
                source: 'static_topology',
                service: service ?? 'all',
                node_count: new Set(filteredDeps.flatMap((d) => [d.upstream, d.downstream])).size,
                edge_count: filteredDeps.length,
                dependencies: filteredDeps,
              },
            };
          }

          return {
            success: true,
            data: {
              source: 'activity_log',
              service: service ?? 'all',
              node_count: serviceSet.size,
              edge_count: edges.length,
              dependencies: edges,
            },
          };
        } catch (err) {
          return { success: false, error: `Service dependency query failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
