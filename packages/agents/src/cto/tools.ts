/**
 * CTO — Tool Definitions
 *
 * Tools for: platform health checks, deployment management,
 * cost optimization, and technical analysis.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import {
  queryCloudRunMetrics,
  pingServices,
  type CloudRunMetrics,
  listOpenPRs,
  listWorkflowRuns,
  getRepoStats,
  createIssue,
  getFileContents,
  createOrUpdateFile,
  createBranch,
  createGitHubPR,
  mergeGitHubPR,
  GLYPHOR_REPOS,
  type GlyphorRepo,
  listCloudBuilds,
  getCloudBuildDetails,
} from '@glyphor/integrations';

export function createCTOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_platform_health',
      description: 'Get current platform health metrics: API latency, error rates, uptime for Cloud Run services.',
      parameters: {
        service: {
          type: 'string',
          description: 'Service to check (or "all" for all services)',
          required: false,
          enum: ['scheduler', 'dashboard', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        const services = [
          { name: 'glyphor-scheduler', url: process.env.SCHEDULER_URL },
          { name: 'glyphor-dashboard', url: process.env.DASHBOARD_URL },
        ].filter((s) => s.url) as Array<{ name: string; url: string }>;

        const serviceFilter = params.service as string | undefined;

        // Try real Cloud Monitoring metrics if GCP project is configured
        let metricsData: CloudRunMetrics[] = [];
        if (projectId) {
          try {
            const serviceIds = serviceFilter && serviceFilter !== 'all'
              ? [`glyphor-${serviceFilter}`]
              : services.map((s) => s.name);
            metricsData = await Promise.all(
              serviceIds.map((id) => queryCloudRunMetrics(projectId, id, 1)),
            );
          } catch (err) {
            console.warn('[CTO] Cloud Monitoring query failed, falling back to health pings:', (err as Error).message);
          }
        }

        // Always run health pings as baseline
        const pingTargets = serviceFilter && serviceFilter !== 'all'
          ? services.filter((s) => s.name.includes(serviceFilter))
          : services;
        const healthChecks = pingTargets.length > 0
          ? await pingServices(pingTargets.map((s) => ({ url: `${s.url}/health`, name: s.name })))
          : [];

        // Also get recent activity for deploy/alert context
        const activity = await memory.getRecentActivity(6);
        const deployEvents = activity.filter(a => a.action === 'deploy');
        // Exclude CTO's own alerts to break self-referencing feedback loop
        const alertEvents = activity.filter(a => a.action === 'alert' && a.agentRole !== 'cto');

        const overallStatus = healthChecks.some((h) => h.status === 'down')
          ? 'degraded'
          : alertEvents.length > 0
            ? 'degraded'
            : 'healthy';

        return {
          success: true,
          data: {
            status: overallStatus,
            cloudRunMetrics: metricsData.length > 0 ? metricsData : undefined,
            healthChecks: healthChecks.length > 0 ? healthChecks : undefined,
            recentDeploys: deployEvents,
            recentAlerts: alertEvents,
            checkedAt: new Date().toISOString(),
          },
        };
      },
    },

    {
      name: 'get_cloud_run_metrics',
      description: 'Get detailed Cloud Run metrics. errorRate = 5xx server errors only (not 3xx/4xx). clientErrorRate = 4xx responses (normal for CORS, auth, 404s). instanceCount = null means scaled-to-zero (healthy idle state, not an outage). instanceStatus indicates running/scaled-to-zero/scaling-down.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service name (e.g., "glyphor-scheduler")',
          required: true,
        },
        hours: {
          type: 'number',
          description: 'Hours to look back (default: 1)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }
        try {
          const metrics = await queryCloudRunMetrics(
            projectId,
            params.service as string,
            (params.hours as number) || 1,
          );
          return { success: true, data: metrics };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_infrastructure_costs',
      description: 'Get infrastructure cost breakdown (Cloud Run, Supabase, API tokens, storage).',
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
        const hasData = financials.length > 0;
        const totalInfra = hasData ? financials.reduce((s, f) => s + f.infraCost, 0) : null;
        const totalApi = hasData ? financials.reduce((s, f) => s + f.apiCost, 0) : null;

        // Check billing sync status
        let billingSyncStatus: string = 'unknown';
        let lastBillingSync: string | null = null;
        try {
          const { data: syncStatus } = await memory.getSupabaseClient()
            .from('data_sync_status')
            .select('status, last_success_at')
            .eq('id', 'gcp-billing')
            .single();
          billingSyncStatus = syncStatus?.status ?? 'unknown';
          lastBillingSync = syncStatus?.last_success_at ?? null;
        } catch { /* ignore */ }

        return {
          success: true,
          data: {
            period: `${days} days`,
            totalInfraCost: totalInfra,
            totalApiCost: totalApi,
            hasData,
            dataStatus: hasData ? 'data_available' : 'no_billing_data_synced',
            billingSyncStatus,
            lastBillingSync,
            dailySnapshots: financials,
            note: hasData
              ? undefined
              : 'No billing data found for this period. The GCP billing export sync has not run or has not populated data yet. This is NOT a platform outage.',
          },
        };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get all agent and system activity from the last N hours.',
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
          description: 'Memory namespace key to read (e.g., "infra.cloud-run", "product.fuse.metrics")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'write_health_report',
      description: 'Write a health check report to company memory and archive to GCS.',
      parameters: {
        report_markdown: {
          type: 'string',
          description: 'The health report content in markdown format',
          required: true,
        },
        status: {
          type: 'string',
          description: 'Overall platform status',
          required: true,
          enum: ['healthy', 'degraded', 'incident'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `reports/cto/health/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          'infra.health.latest',
          { status: params.status, date, report: params.report_markdown },
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
          enum: ['analysis', 'deploy', 'alert'],
        },
        summary: {
          type: 'string',
          description: 'Short summary of the activity',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Related product',
          required: false,
          enum: ['fuse', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'deploy' | 'alert',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_github_pr_status',
      description: 'List open pull requests across Fuse, Pulse, and the AI company repo. Shows CI status, reviewers, and labels.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Which repo to check: "company", "fuse", "pulse", or "all" (default: all)',
          required: false,
          enum: ['company', 'fuse', 'pulse', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const repoKey = (params.repo as GlyphorRepo | 'all' | undefined);
          const prs = await listOpenPRs(repoKey === 'all' || !repoKey ? undefined : repoKey);
          const summary = {
            total: prs.length,
            failing: prs.filter((p) => p.ciStatus === 'failure').length,
            pending: prs.filter((p) => p.ciStatus === 'pending').length,
            drafts: prs.filter((p) => p.draft).length,
            prs,
          };
          return { success: true, data: summary };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured yet.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'get_ci_health',
      description: 'Get CI/CD pipeline health — recent workflow run results (pass/fail/in-progress) for a specific repo.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo to check: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
        },
        limit: {
          type: 'number',
          description: 'Number of recent runs to fetch (default: 10)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const runs = await listWorkflowRuns(params.repo as GlyphorRepo, (params.limit as number) || 10);
          const passed = runs.filter((r) => r.conclusion === 'success').length;
          const failed = runs.filter((r) => r.conclusion === 'failure').length;
          const passRate = runs.length > 0 ? Math.round((passed / runs.length) * 100) : null;
          return {
            success: true,
            data: { passRate, passed, failed, inProgress: runs.filter((r) => r.status === 'in_progress').length, runs },
          };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured yet.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'get_repo_stats',
      description: 'Get high-level code health stats for a repo: open PRs, issues, CI pass rate, last push.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo to check: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const stats = await getRepoStats(params.repo as GlyphorRepo);
          return { success: true, data: stats };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured yet.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'create_github_issue',
      description: 'Create a GitHub issue on a Glyphor repo (e.g., to track a bug, performance regression, or tech-debt item).',
      parameters: {
        repo: {
          type: 'string',
          description: 'Target repo: "company", "fuse", or "pulse"',
          required: true,
          enum: ['company', 'fuse', 'pulse'],
        },
        title: {
          type: 'string',
          description: 'Issue title',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Issue body in markdown',
          required: true,
        },
        labels: {
          type: 'array',
          description: 'Labels to apply (e.g. ["bug", "P1"])',
          required: false,
          items: { type: 'string', description: 'Label name' },
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await createIssue(
            params.repo as GlyphorRepo,
            params.title as string,
            params.body as string,
            params.labels as string[] | undefined,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured yet.' };
          return { success: false, error: msg };
        }
      },
    },

    // ─── Cloud Build ────────────────────────────────────────────

    {
      name: 'list_cloud_builds',
      description: 'List recent GCP Cloud Build runs. Shows status, duration, images, and failure info. Use this to find failed builds and get their build IDs for further investigation.',
      parameters: {
        limit: {
          type: 'number',
          description: 'Number of recent builds to list (default: 10)',
          required: false,
        },
        status: {
          type: 'string',
          description: 'Filter by status: "SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED", or omit for all',
          required: false,
          enum: ['SUCCESS', 'FAILURE', 'TIMEOUT', 'CANCELLED'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }
        try {
          const builds = await listCloudBuilds(
            projectId,
            (params.limit as number) || 10,
            params.status as string | undefined,
          );
          const failed = builds.filter((b) => b.status === 'FAILURE' || b.status === 'TIMEOUT');
          return {
            success: true,
            data: {
              total: builds.length,
              failed: failed.length,
              builds,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_cloud_build_logs',
      description: 'Get detailed Cloud Build log for a specific build — step-by-step status, timing, failure reason, and log URL. Use the build ID from list_cloud_builds.',
      parameters: {
        build_id: {
          type: 'string',
          description: 'The Cloud Build build ID to inspect',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }
        try {
          const details = await getCloudBuildDetails(projectId, params.build_id as string);
          return { success: true, data: details };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision that requires founder approval (e.g., costly model switch, production deploy).',
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
          description: 'Decision context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Technical justification',
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

    // ─── CODE AUTHORING — Agent Self-Extension ──────────────────

    {
      name: 'get_file_contents',
      description: 'Read a file from the GitHub repo. Use this to read existing tool code before modifying it, or to understand how existing tools are structured.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo name (e.g. "glyphor-ai-company")',
          required: true,
        },
        path: {
          type: 'string',
          description: 'File path in the repo (e.g. "packages/agents/src/cpo/tools.ts")',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch to read from (defaults to "main")',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await getFileContents(
            params.repo as string,
            params.path as string,
            params.branch as string | undefined,
          );
          if (!result) {
            return { success: true, data: { exists: false, path: params.path } };
          }
          return { success: true, data: { exists: true, ...result } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_or_update_file',
      description: 'Create or update a file in the GitHub repo on a feature branch. NEVER write directly to main — always use a feature branch. Use this to add new tool declarations, implement tool handlers, modify system prompts, or create new agent files.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo name (e.g. "glyphor-ai-company")',
          required: true,
        },
        path: {
          type: 'string',
          description: 'File path in the repo',
          required: true,
        },
        content: {
          type: 'string',
          description: 'The COMPLETE file content (not a diff)',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Target branch — must start with "feature/agent-"',
          required: true,
        },
        commit_message: {
          type: 'string',
          description: 'Commit message in conventional commit format',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const branch = params.branch as string;
        const path = params.path as string;

        // SAFETY: Branch name enforcement
        if (!branch.startsWith('feature/agent-')) {
          return {
            success: false,
            error: 'Branch name must start with "feature/agent-". Direct writes to main, staging, or production branches are forbidden.',
          };
        }

        // SAFETY: Path blocklist — RED-tier files require human review
        const BLOCKED_PATHS = [
          'packages/agent-runtime/src/companyAgentRunner.ts',
          'packages/scheduler/src/authorityGates.ts',
        ];
        const BLOCKED_PREFIXES = [
          'infra/',
          '.github/workflows/',
          'docker/',
        ];
        const BLOCKED_PATTERNS = [
          /AGENT_BUDGETS/,
        ];

        if (BLOCKED_PATHS.includes(path)) {
          return {
            success: false,
            error: `Path "${path}" is a RED-tier protected file. Changes require human review in Cursor.`,
          };
        }
        for (const prefix of BLOCKED_PREFIXES) {
          if (path.startsWith(prefix)) {
            return {
              success: false,
              error: `Path "${path}" is in a protected directory (${prefix}). Changes require human review.`,
            };
          }
        }

        // Check file content for budget-cap manipulation
        const content = params.content as string;
        for (const pattern of BLOCKED_PATTERNS) {
          if (pattern.test(content) && path.includes('types.ts')) {
            return {
              success: false,
              error: 'Cannot modify AGENT_BUDGETS section in types.ts. Budget cap changes require human review.',
            };
          }
        }

        try {
          const result = await createOrUpdateFile(
            params.repo as string,
            path,
            content,
            branch,
            params.commit_message as string,
          );

          // Log file write to activity log
          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `GitHub file ${result.created_or_updated}: ${path} on ${branch}`,
            details: { repo: params.repo, path, branch, commit_sha: result.commit_sha },
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_branch',
      description: 'Create a new feature branch from main for tool or agent development. Branch names must follow the pattern: feature/agent-{description}.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo name (e.g. "glyphor-ai-company")',
          required: true,
        },
        branch_name: {
          type: 'string',
          description: 'Branch name — must match pattern feature/agent-*',
          required: true,
        },
        from_ref: {
          type: 'string',
          description: 'Source ref (defaults to "main")',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const branchName = params.branch_name as string;

        if (!branchName.startsWith('feature/agent-')) {
          return {
            success: false,
            error: 'Branch name must start with "feature/agent-".',
          };
        }

        try {
          const result = await createBranch(
            params.repo as string,
            branchName,
            (params.from_ref as string) || 'main',
          );

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Created branch ${branchName} from ${(params.from_ref as string) || 'main'}`,
            details: { repo: params.repo, branch: branchName, sha: result.sha },
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_github_pr',
      description: 'Open a pull request from a feature branch to main. CI runs automatically on the PR.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo name (e.g. "glyphor-ai-company")',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Source branch for the PR',
          required: true,
        },
        title: {
          type: 'string',
          description: 'PR title',
          required: true,
        },
        body: {
          type: 'string',
          description: 'PR description in markdown',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const result = await createGitHubPR(
            params.repo as string,
            params.branch as string,
            params.title as string,
            params.body as string,
          );

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Opened PR #${result.number}: ${params.title}`,
            details: { repo: params.repo, branch: params.branch, pr_number: result.number, url: result.url },
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'merge_github_pr',
      description: 'Merge a pull request after CI passes. Uses squash merge.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo name (e.g. "glyphor-ai-company")',
          required: true,
        },
        pr_number: {
          type: 'number',
          description: 'Pull request number to merge',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const result = await mergeGitHubPR(
            params.repo as string,
            params.pr_number as number,
          );

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Merged PR #${params.pr_number}`,
            details: { repo: params.repo, pr_number: params.pr_number, sha: result.sha },
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── Supabase — Database Health & Diagnostics ───────────────

    {
      name: 'query_supabase_health',
      description: 'Check Supabase connectivity, query latency, and connection pool state.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const start = Date.now();
          const { data, error } = await supabase.from('company_agents').select('role').limit(1);
          const latencyMs = Date.now() - start;
          return {
            success: true,
            data: { connected: !error, queryLatencyMs: latencyMs, error: error?.message, checkedAt: new Date().toISOString() },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'query_supabase_table',
      description: 'Read-only query on a Supabase table for diagnostics. Returns matching rows. Use this to investigate data issues, check agent state, review schedules, or diagnose problems.',
      parameters: {
        table: {
          type: 'string',
          description: 'Table name to query',
          required: true,
          enum: [
            'company_agents', 'agent_schedules', 'agent_runs', 'agent_performance',
            'agent_memory', 'agent_reflections', 'activity_log', 'work_assignments',
            'decisions', 'agent_messages', 'infrastructure_metrics', 'gcp_billing',
            'products', 'financials', 'company_profile',
          ],
        },
        select: {
          type: 'string',
          description: 'Columns to select (default: "*"). E.g. "role,status,last_run_at"',
          required: false,
        },
        filters: {
          type: 'object',
          description: 'Equality filters as key-value pairs. E.g. {"status": "active", "department": "engineering"}',
          required: false,
        },
        order_by: {
          type: 'string',
          description: 'Column to order by (descending). E.g. "created_at"',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 25, max: 100)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const table = params.table as string;
          const selectCols = (params.select as string) || '*';
          const limit = Math.min((params.limit as number) || 25, 100);

          let query = supabase.from(table).select(selectCols);

          const filters = params.filters as Record<string, string> | undefined;
          if (filters) {
            for (const [col, val] of Object.entries(filters)) {
              query = query.eq(col, val);
            }
          }

          if (params.order_by) {
            query = query.order(params.order_by as string, { ascending: false });
          }

          query = query.limit(limit);

          const { data, error } = await query;
          if (error) return { success: false, error: error.message };
          return { success: true, data: { table, rowCount: (data as unknown[]).length, rows: data } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── Agent Management ───────────────────────────────────────

    {
      name: 'list_agents',
      description: 'List all agents with their status, last run time, performance score, model, and department.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by status (default: all)',
          required: false,
          enum: ['active', 'inactive', 'disabled'],
        },
        department: {
          type: 'string',
          description: 'Filter by department (e.g. "engineering", "product")',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          let query = supabase.from('company_agents')
            .select('role, display_name, title, department, model, status, is_core, last_run_at, last_run_duration_ms, last_run_cost_usd, performance_score');

          if (params.status) query = query.eq('status', params.status as string);
          if (params.department) query = query.eq('department', params.department as string);

          const { data, error } = await query.order('department').order('role');
          if (error) return { success: false, error: error.message };
          return { success: true, data: { count: (data as unknown[]).length, agents: data } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_agent_run_history',
      description: 'Get recent run history for a specific agent — shows when it ran, duration, cost, success/failure.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role ID (e.g. "cto", "cpo", "platform-engineer")',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Number of recent runs (default: 10)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const { data, error } = await supabase.from('agent_runs')
            .select('*')
            .eq('agent_role', params.agent_role as string)
            .order('created_at', { ascending: false })
            .limit((params.limit as number) || 10);

          if (error) return { success: false, error: error.message };

          const lastSummary = await memory.getLastRunSummary(params.agent_role as string);
          return {
            success: true,
            data: {
              agentRole: params.agent_role,
              runs: data,
              lastSummary: lastSummary?.summary,
              lastRunAt: lastSummary?.lastRunAt,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'update_agent_status',
      description: 'Activate or deactivate an agent. Use this to disable a misbehaving agent or re-enable one after a fix.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role ID (e.g. "platform-engineer", "devops-engineer")',
          required: true,
        },
        status: {
          type: 'string',
          description: 'New status',
          required: true,
          enum: ['active', 'inactive'],
        },
        reason: {
          type: 'string',
          description: 'Reason for the status change',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const agentRole = params.agent_role as string;
          const newStatus = params.status as string;

          const { error } = await supabase.from('company_agents')
            .update({ status: newStatus })
            .eq('role', agentRole);

          if (error) return { success: false, error: error.message };

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Agent ${agentRole} set to ${newStatus}: ${params.reason}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: { agentRole, status: newStatus, reason: params.reason } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_agent_schedules',
      description: 'List all agent schedules — shows cron expressions, enabled/disabled state, and next run metadata.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Filter by agent role (omit for all schedules)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          let query = supabase.from('agent_schedules').select('*');
          if (params.agent_role) query = query.eq('agent_role', params.agent_role as string);
          const { data, error } = await query.order('agent_role');
          if (error) return { success: false, error: error.message };
          return { success: true, data: { count: (data as unknown[]).length, schedules: data } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'update_agent_schedule',
      description: 'Enable, disable, or modify an agent schedule. Use this to pause a runaway agent or adjust run frequency.',
      parameters: {
        schedule_id: {
          type: 'string',
          description: 'The schedule ID (from get_agent_schedules)',
          required: true,
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the schedule',
          required: false,
        },
        cron: {
          type: 'string',
          description: 'New cron expression (e.g. "0 */4 * * *" for every 4 hours)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const updates: Record<string, unknown> = {};
          if (params.enabled !== undefined) updates.enabled = params.enabled;
          if (params.cron) updates.cron_expression = params.cron;

          if (Object.keys(updates).length === 0) {
            return { success: false, error: 'No updates specified — provide enabled and/or cron.' };
          }

          const { error } = await supabase.from('agent_schedules')
            .update(updates)
            .eq('id', params.schedule_id as string);

          if (error) return { success: false, error: error.message };

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Updated schedule ${params.schedule_id}: ${JSON.stringify(updates)}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: { scheduleId: params.schedule_id, updates } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_agent_performance',
      description: 'Get performance metrics for an agent — success rate, avg duration, cost trends, quality scores.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role ID',
          required: true,
        },
        days: {
          type: 'number',
          description: 'Days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const supabase = memory.getSupabaseClient();
          const agentRole = params.agent_role as string;
          const days = (params.days as number) || 7;
          const since = new Date(Date.now() - days * 86400000).toISOString();

          const [perfResult, reflResult, qualityScore] = await Promise.all([
            supabase.from('agent_performance')
              .select('*')
              .eq('agent_role', agentRole)
              .gte('recorded_at', since)
              .order('recorded_at', { ascending: false })
              .limit(30),
            memory.getReflections(agentRole as CompanyAgentRole, 5),
            memory.getAverageQualityScore(agentRole as CompanyAgentRole, days),
          ]);

          return {
            success: true,
            data: {
              agentRole,
              period: `${days}d`,
              performance: perfResult.data,
              qualityScore,
              recentReflections: reflResult,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
