/**
 * CTO — Tool Definitions
 *
 * Tools for: platform health checks, deployment management,
 * cost optimization, and technical analysis.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { systemQuery } from '@glyphor/shared/db';
import {
  queryCloudRunMetrics,
  pingServices,
  type CloudRunMetrics,
  listOpenPRs,
  listWorkflowRuns,
  getRepoStats,
  createIssueForCopilot,
  listRecentCommits,
  commentOnPR,
  getFileContents,
  createOrUpdateFile,
  createBranch,
  createGitHubPR,
  mergeGitHubPR,
  GLYPHOR_REPOS,
  type GlyphorRepo,
  listCloudBuilds,
  getCloudBuildDetails,
  resolveGcpProjectIdForCloudBuild,
  GraphTeamsClient,
  buildChannelMap,
  postTextToChannel,
  type ChannelTarget,
  searchWeb,
} from '@glyphor/integrations';

import { normalizeCloudRunServiceName } from '../shared/cloudRunServiceName.js';

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
      description: 'Get infrastructure cost breakdown (Cloud Run, Cloud SQL, API tokens, storage).',
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
          const rows = await systemQuery<{ status: string; last_success_at: string | null }>(
            'SELECT status, last_success_at FROM data_sync_status WHERE id=$1', ['gcp-billing'],
          );
          const syncStatus = rows[0];
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
          description: 'Memory namespace key to read (e.g., "infra.cloud-run", "infra.health.latest")',
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
        const path = `reports/cto/health/${date}.md`;
        const markdown = params.report_markdown as string;
        // CompanyMemoryStore implements GCS writeDocument; IMemoryBus stubs may not — fall back to KV only.
        const store = memory as CompanyMemoryStore & {
          writeDocument?: (p: string, c: string) => Promise<void>;
        };
        if (typeof store.writeDocument === 'function') {
          await store.writeDocument(path, markdown);
        } else {
          await memory.write(
            `infra.health.report.${date}`,
            { path, report: markdown, status: params.status },
            ctx.agentId,
          );
        }
        await memory.write(
          'infra.health.latest',
          { status: params.status, date, report: markdown },
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
          description: 'Related engine or company-wide',
          required: false,
          enum: ['company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'deploy' | 'alert',
          product: 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_github_pr_status',
      description: 'List open pull requests in the company repo. Shows CI status, reviewers, and labels.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo to check: "company"',
          required: false,
          enum: ['company'],
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
          description: 'Repo to check: "company"',
          required: true,
          enum: ['company'],
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
          description: 'Repo to check: "company"',
          required: true,
          enum: ['company'],
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
          description: 'Target repo: "company"',
          required: true,
          enum: ['company'],
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
          const result = await createIssueForCopilot(
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
        const projectId = resolveGcpProjectIdForCloudBuild();
        if (!projectId) {
          return {
            success: false,
            error:
              'Cloud Build listBuilds skipped: no GCP project id. Set GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT). ' +
              'API would be: CloudBuildClient.listBuilds({ projectId, pageSize, filter? })',
          };
        }
        const limit = (params.limit as number) || 10;
        const statusFilter = params.status as string | undefined;
        try {
          const builds = await listCloudBuilds(projectId, limit, statusFilter);
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
          const msg = (err as Error).message;
          return {
            success: false,
            error: `${msg} | API: listBuilds({ projectId: "${projectId}", pageSize: ${Math.min(100, Math.max(1, limit))}, filter: ${statusFilter ? `"status=\\"${statusFilter}\\""` : 'none'} })`,
          };
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
        const projectId = resolveGcpProjectIdForCloudBuild();
        const buildId = params.build_id as string;
        if (!projectId) {
          return {
            success: false,
            error:
              'Cloud Build getBuild skipped: no GCP project id. Set GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT). ' +
              `API would be: getBuild({ name: "projects/{project}/locations/-/builds/${buildId}" })`,
          };
        }
        try {
          const details = await getCloudBuildDetails(projectId, buildId);
          return { success: true, data: details };
        } catch (err) {
          const msg = (err as Error).message;
          return {
            success: false,
            error: `${msg} | API: getBuild({ name: "projects/${projectId}/locations/-/builds/${buildId}" })`,
          };
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

    // ─── Database Health & Diagnostics ───────────────────────────

    {
      name: 'query_db_health',
      description: 'Check Cloud SQL connectivity, query latency, and connection pool state.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const start = Date.now();
          await systemQuery('SELECT role FROM company_agents LIMIT 1');
          const latencyMs = Date.now() - start;
          return {
            success: true,
            data: { connected: true, queryLatencyMs: latencyMs, checkedAt: new Date().toISOString() },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'query_db_table',
      description: 'Read-only query on a database table for diagnostics. Returns matching rows. Use this to investigate data issues, check agent state, review schedules, or diagnose problems.',
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
          const table = params.table as string;
          const limit = Math.min((params.limit as number) || 25, 100);

          const ALLOWED_TABLES = [
            'company_agents', 'agent_schedules', 'agent_runs', 'agent_performance',
            'agent_memory', 'agent_reflections', 'activity_log', 'work_assignments',
            'decisions', 'agent_messages', 'infrastructure_metrics', 'gcp_billing',
            'products', 'financials', 'company_profile',
          ];
          if (!ALLOWED_TABLES.includes(table)) {
            return { success: false, error: `Table "${table}" is not in the allowed list.` };
          }

          // Validate select columns — only allow simple identifiers and *
          const selectCols = (params.select as string) || '*';
          const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
          if (selectCols !== '*') {
            const cols = selectCols.split(',').map(c => c.trim());
            for (const c of cols) {
              if (!IDENTIFIER_RE.test(c)) {
                return { success: false, error: `Invalid column name: "${c}". Only simple column names are allowed.` };
              }
            }
          }

          const conditions: string[] = [];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          const filters = params.filters as Record<string, string> | undefined;
          if (filters) {
            for (const [col, val] of Object.entries(filters)) {
              if (!IDENTIFIER_RE.test(col)) {
                return { success: false, error: `Invalid filter column: "${col}". Only simple column names are allowed.` };
              }
              conditions.push(`${col}=$${paramIndex++}`);
              queryParams.push(val);
            }
          }

          let sql = `SELECT ${selectCols} FROM ${table}`;
          if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
          }

          if (params.order_by) {
            const orderCol = String(params.order_by);
            if (!IDENTIFIER_RE.test(orderCol)) {
              return { success: false, error: `Invalid order_by column: "${orderCol}". Only simple column names are allowed.` };
            }
            sql += ` ORDER BY ${orderCol} DESC`;
          }

          queryParams.push(limit);
          sql += ` LIMIT $${paramIndex}`;

          const data = await systemQuery(sql, queryParams);
          return { success: true, data: { table, rowCount: data.length, rows: data } };
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
          enum: ['active', 'paused', 'inactive', 'disabled'],
        },
        department: {
          type: 'string',
          description: 'Filter by department (e.g. "engineering", "product")',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          if (params.status) {
            conditions.push(`status=$${paramIndex++}`);
            queryParams.push(params.status as string);
          }
          if (params.department) {
            conditions.push(`department=$${paramIndex++}`);
            queryParams.push(params.department as string);
          }

          let sql = 'SELECT role, display_name, title, department, model, status, is_core, last_run_at, last_run_duration_ms, last_run_cost_usd, performance_score FROM company_agents';
          if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
          }
          sql += ' ORDER BY department, role';

          const data = await systemQuery(sql, queryParams);
          return { success: true, data: { count: data.length, agents: data } };
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
          const data = await systemQuery(
            'SELECT * FROM agent_runs WHERE agent_id=$1 ORDER BY created_at DESC LIMIT $2',
            [params.agent_role as string, (params.limit as number) || 10],
          );

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
      description: 'Change an agent\'s status. Use to reactivate a paused agent, disable a misbehaving one, or re-enable after a fix. Agents paused by Atlas (ops) can be reactivated by setting status to "active". Pausing chief-of-staff or ops requires founder approval and will be rejected by this tool.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role ID (e.g. "platform-engineer", "devops-engineer", "vp-design")',
          required: true,
        },
        status: {
          type: 'string',
          description: 'New status (use "active" to reactivate a paused agent)',
          required: true,
          enum: ['active', 'paused', 'inactive'],
        },
        reason: {
          type: 'string',
          description: 'Reason for the status change',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const agentRole = params.agent_role as string;
          const newStatus = params.status as string;
          const reason = params.reason as string;

          // Protected-role guard: pausing the orchestrator or the health watcher
          // is a founder-level decision, not a CTO unilateral call. Allow
          // reactivation (status=active) because that's a recovery path.
          const PROTECTED_STATUS_CHANGE_ROLES = new Set(['chief-of-staff', 'ops']);
          if (PROTECTED_STATUS_CHANGE_ROLES.has(agentRole) && newStatus !== 'active') {
            return {
              success: false,
              error: `Cannot change status of protected agent "${agentRole}" to "${newStatus}" via update_agent_status. Escalate to founders instead.`,
            };
          }

          // Capture previous status so the audit record shows the transition.
          const [prev] = await systemQuery<{ status: string }>(
            'SELECT status FROM company_agents WHERE role=$1',
            [agentRole],
          );
          if (!prev) {
            return { success: false, error: `No agent found with role "${agentRole}".` };
          }
          const previousStatus = prev.status;

          await systemQuery('UPDATE company_agents SET status=$1, updated_at=NOW() WHERE role=$2', [newStatus, agentRole]);

          const action =
            newStatus === 'paused' ? 'agent.paused' :
            newStatus === 'active' ? 'agent.resumed' :
            'agent.status_changed';
          const tier = newStatus === 'paused' ? 'yellow' : 'green';

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action,
            tier,
            product: 'company',
            summary: `${ctx.agentRole} changed ${agentRole} status: ${previousStatus} -> ${newStatus}. Reason: ${reason}`,
            details: {
              tool: 'update_agent_status',
              source: 'cto-tool',
              caller_role: ctx.agentRole,
              target_role: agentRole,
              previous_status: previousStatus,
              new_status: newStatus,
              reason,
            },
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: { agentRole, previousStatus, status: newStatus, reason } };
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
          const queryParams: unknown[] = [];
          let sql = 'SELECT * FROM agent_schedules';
          if (params.agent_role) {
            sql += ' WHERE agent_role=$1';
            queryParams.push(params.agent_role as string);
          }
          sql += ' ORDER BY agent_role';

          const data = await systemQuery(sql, queryParams);
          return { success: true, data: { count: data.length, schedules: data } };
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
          const setClauses: string[] = [];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          if (params.enabled !== undefined) {
            setClauses.push(`enabled=$${paramIndex++}`);
            queryParams.push(params.enabled);
          }
          if (params.cron) {
            setClauses.push(`cron_expression=$${paramIndex++}`);
            queryParams.push(params.cron);
          }

          if (setClauses.length === 0) {
            return { success: false, error: 'No updates specified — provide enabled and/or cron.' };
          }

          queryParams.push(params.schedule_id as string);
          await systemQuery(
            `UPDATE agent_schedules SET ${setClauses.join(', ')} WHERE id=$${paramIndex}`,
            queryParams,
          );

          const updates: Record<string, unknown> = {};
          if (params.enabled !== undefined) updates.enabled = params.enabled;
          if (params.cron) updates.cron_expression = params.cron;

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
          const agentRole = params.agent_role as string;
          const days = (params.days as number) || 7;
          const since = new Date(Date.now() - days * 86400000).toISOString();

          const [perfData, reflResult, qualityScore] = await Promise.all([
            systemQuery(
              'SELECT * FROM agent_performance WHERE agent_role=$1 AND recorded_at >= $2 ORDER BY recorded_at DESC LIMIT 30',
              [agentRole, since],
            ),
            memory.getReflections(agentRole as CompanyAgentRole, 5),
            memory.getAverageQualityScore(agentRole as CompanyAgentRole, days),
          ]);

          return {
            success: true,
            data: {
              agentRole,
              period: `${days}d`,
              performance: perfData,
              qualityScore,
              recentReflections: reflResult,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── INCIDENT MANAGEMENT ────────────────────────────────────

    {
      name: 'create_incident',
      description: 'Create a platform incident record. Use when a service is degraded or down. Severity P0=total outage, P1=major degradation, P2=partial, P3=minor.',
      parameters: {
        severity: {
          type: 'string',
          description: 'Incident severity level',
          required: true,
          enum: ['P0', 'P1', 'P2', 'P3'],
        },
        title: {
          type: 'string',
          description: 'Short incident title (e.g. "Scheduler 5xx spike")',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Detailed description of the incident, symptoms, and affected services',
          required: true,
        },
        affected_services: {
          type: 'array',
          description: 'List of affected services',
          required: false,
          items: { type: 'string', description: 'Service name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const severity = params.severity as string;
        const title = params.title as string;
        const description = params.description as string;

        // Guard: Block P0/P1 incidents based on known hallucination patterns
        const combinedText = `${title} ${description}`;
        const HALLUCINATION_PATTERNS = [
          /(?:total|complete|system-wide)\s*(?:blackout|collapse|outage)/i,
          /(?:comms?|communications?)\s*blackout/i,
          /100%\s*(?:user|users?)\s*(?:dormancy|lockout)/i,
          /0%\s*(?:user\s*)?activity/i,
          /telemetry\s*(?:is\s*)?severed/i,
          /Phantom\s*(?:Pipeline|Recovery)/i,
        ];
        if ((severity === 'P0' || severity === 'P1') && HALLUCINATION_PATTERNS.some(p => p.test(combinedText))) {
          console.warn(`[IncidentGuard] Blocked likely hallucinated ${severity} from ${ctx.agentRole}: ${title}`);
          return {
            success: false,
            error: `Incident rejected: "${title}" matches known hallucination patterns. P0/P1 incidents require positive evidence of failure (5xx errors, failed health pings), not inferred outages from missing data or scaled-to-zero instances.`,
          };
        }

        try {
          const incident = {
            severity,
            title,
            description,
            affected_services: params.affected_services as string[] || [],
            status: 'open',
            opened_by: ctx.agentRole,
            opened_at: new Date().toISOString(),
          };

          // Store in company memory
          const incidentId = `incident-${Date.now()}`;
          await memory.write(`incidents.${incidentId}`, incident, ctx.agentId);

          // Log to activity feed
          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'alert',
            product: 'company',
            summary: `[${params.severity}] Incident opened: ${params.title}`,
            details: incident,
            createdAt: new Date().toISOString(),
          });

          // P0/P1 auto-creates a founder decision
          if (params.severity === 'P0' || params.severity === 'P1') {
            await memory.createDecision({
              tier: 'yellow',
              status: 'pending',
              title: `[${params.severity}] ${params.title}`,
              summary: params.description as string,
              proposedBy: ctx.agentRole,
              reasoning: `Incident auto-escalated due to ${params.severity} severity.`,
              assignedTo: ['Kristina', 'Andrew'],
            });
          }

          return { success: true, data: { incidentId, ...incident }, memoryKeysWritten: 1 };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'resolve_incident',
      description: 'Close an incident with root cause analysis and resolution notes.',
      parameters: {
        incident_id: {
          type: 'string',
          description: 'The incident ID from create_incident',
          required: true,
        },
        root_cause: {
          type: 'string',
          description: 'Root cause analysis',
          required: true,
        },
        resolution: {
          type: 'string',
          description: 'What was done to resolve the incident',
          required: true,
        },
        prevention: {
          type: 'string',
          description: 'Steps to prevent recurrence',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const incidentId = params.incident_id as string;
          const existing = await memory.read<Record<string, unknown>>(`incidents.${incidentId}`);
          if (!existing) {
            return { success: false, error: `Incident ${incidentId} not found` };
          }

          const resolved = {
            ...existing,
            status: 'resolved',
            root_cause: params.root_cause,
            resolution: params.resolution,
            prevention: params.prevention,
            resolved_by: ctx.agentRole,
            resolved_at: new Date().toISOString(),
          };

          await memory.write(`incidents.${incidentId}`, resolved, ctx.agentId);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Incident resolved: ${(existing as any).title} — ${params.root_cause}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: resolved, memoryKeysWritten: 1 };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── DEPLOYMENT — Cloud Run ─────────────────────────────────

    {
      name: 'deploy_cloud_run',
      description: 'Trigger a Cloud Build deploy for a Cloud Run service. This creates a new build from the latest source. For staging deploys (GREEN). Production deploys require a decision (YELLOW).',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service to deploy (short id or full name, e.g. scheduler or glyphor-scheduler)',
          required: true,
          enum: ['scheduler', 'worker', 'dashboard', 'voice-gateway'],
        },
        environment: {
          type: 'string',
          description: 'Target environment',
          required: true,
          enum: ['staging', 'production'],
        },
        reason: {
          type: 'string',
          description: 'Reason for the deployment',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const environment = params.environment as string;
        const service = params.service as string;
        const cloudRunServiceId = normalizeCloudRunServiceName(service);

        // Production deploys require a decision
        if (environment === 'production') {
          const decisionId = await memory.createDecision({
            tier: 'yellow',
            status: 'pending',
            title: `Production deploy: ${cloudRunServiceId}`,
            summary: `${params.reason}`,
            proposedBy: ctx.agentRole,
            reasoning: `Production deployment of ${cloudRunServiceId} requires founder approval.`,
            assignedTo: ['Kristina', 'Andrew'],
          });
          return {
            success: true,
            data: {
              status: 'pending_approval',
              decisionId,
              message: `Production deploy requires approval. Decision ${decisionId} created.`,
            },
          };
        }

        // Staging deploys — trigger Cloud Build
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }

        try {
          const token = await getGCPAccessToken();
          const triggersUrl = `https://cloudbuild.googleapis.com/v1/projects/${projectId}/triggers`;
          const triggersRes = await fetch(triggersUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const triggersData = await triggersRes.json() as { triggers?: Array<{ id: string; name: string; description?: string }> };
          const triggers = triggersData.triggers || [];

          // Find matching trigger for the service
          const trigger = triggers.find((t: { id: string; name: string; description?: string }) =>
            t.name.includes(service) || (t.description && t.description.includes(service)),
          );

          if (!trigger) {
            return {
              success: false,
              error: `No Cloud Build trigger found for service "${service}". Available triggers: ${triggers.map((t: { name: string }) => t.name).join(', ')}`,
            };
          }

          // Trigger the build
          const runUrl = `https://cloudbuild.googleapis.com/v1/projects/${projectId}/triggers/${trigger.id}:run`;
          const runRes = await fetch(runUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ branchName: 'main' }),
          });

          if (!runRes.ok) {
            const errText = await runRes.text();
            return { success: false, error: `Cloud Build trigger failed: ${runRes.status} ${errText}` };
          }

          const buildData = await runRes.json() as { metadata?: { build?: { id?: string; logUrl?: string } } };
          const buildId = buildData.metadata?.build?.id;

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Triggered ${environment} deploy for ${cloudRunServiceId} via Cloud Build`,
            details: { service, environment, buildId, trigger: trigger.name },
            createdAt: new Date().toISOString(),
          });

          return {
            success: true,
            data: {
              buildId,
              trigger: trigger.name,
              logUrl: buildData.metadata?.build?.logUrl,
              environment,
              service: cloudRunServiceId,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'rollback_cloud_run',
      description: 'Rollback a Cloud Run service to its previous revision. GREEN authority — safety valve for bad deploys.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service to rollback (short id or full name, e.g. scheduler or glyphor-scheduler)',
          required: true,
          enum: ['scheduler', 'worker', 'dashboard', 'voice-gateway'],
        },
        reason: {
          type: 'string',
          description: 'Reason for the rollback',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          return { success: false, error: 'GCP_PROJECT_ID not configured' };
        }

        const serviceName = normalizeCloudRunServiceName(params.service as string);
        const region = 'us-central1';

        try {
          const token = await getGCPAccessToken();

          // List revisions to find previous
          const listUrl = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${serviceName}/revisions`;
          const listRes = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!listRes.ok) {
            return { success: false, error: `Failed to list revisions: ${listRes.status}` };
          }

          const listData = await listRes.json() as { revisions?: Array<{ name: string; createTime: string }> };
          const revisions = (listData.revisions || []).sort(
            (a: { createTime: string }, b: { createTime: string }) =>
              new Date(b.createTime).getTime() - new Date(a.createTime).getTime(),
          );

          if (revisions.length < 2) {
            return { success: false, error: 'No previous revision available for rollback' };
          }

          const currentRevision = revisions[0].name.split('/').pop()!;
          const previousRevision = revisions[1].name.split('/').pop()!;

          // Route 100% traffic to previous revision — use updateMask to only change traffic
          const serviceUrl = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${serviceName}`;
          const getRes = await fetch(serviceUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const serviceData = await getRes.json() as Record<string, unknown>;

          const patchUrl = `${serviceUrl}?updateMask=traffic`;
          const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...serviceData,
              traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: previousRevision, percent: 100 }],
            }),
          });

          if (!patchRes.ok) {
            const errText = await patchRes.text();
            return { success: false, error: `Rollback failed: ${patchRes.status} ${errText}` };
          }

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Rolled back ${serviceName}: ${currentRevision} → ${previousRevision}. Reason: ${params.reason}`,
            createdAt: new Date().toISOString(),
          });

          return {
            success: true,
            data: {
              service: serviceName,
              rolledBackFrom: currentRevision,
              rolledBackTo: previousRevision,
              reason: params.reason,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── MODEL CONFIGURATION ────────────────────────────────────

    {
      name: 'update_model_config',
      description: 'Update an agent\'s AI model configuration. GREEN for model fallbacks and temperature tuning. YELLOW if monthly cost impact > $50.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to update (e.g. "cto", "cpo", "cmo")',
          required: true,
        },
        model: {
          type: 'string',
          description: 'New model name (e.g. "gemini-3.1-flash-lite-preview", "gpt-5.4-mini", "model-router")',
          required: false,
        },
        temperature: {
          type: 'number',
          description: 'New temperature (0.0 - 1.0)',
          required: false,
        },
        max_turns: {
          type: 'number',
          description: 'Max turns per run',
          required: false,
        },
        reason: {
          type: 'string',
          description: 'Reason for the model change',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const agentRole = params.agent_role as string;
          const setClauses: string[] = [];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          if (params.model) {
            setClauses.push(`model=$${paramIndex++}`);
            queryParams.push(params.model);
          }
          if (params.temperature !== undefined) {
            setClauses.push(`temperature=$${paramIndex++}`);
            queryParams.push(params.temperature);
          }
          if (params.max_turns) {
            setClauses.push(`max_turns=$${paramIndex++}`);
            queryParams.push(params.max_turns);
          }

          if (setClauses.length === 0) {
            return { success: false, error: 'No updates specified — provide model, temperature, or max_turns.' };
          }

          queryParams.push(agentRole);
          await systemQuery(
            `UPDATE company_agents SET ${setClauses.join(', ')} WHERE role=$${paramIndex}`,
            queryParams,
          );

          const updates: Record<string, unknown> = {};
          if (params.model) updates.model = params.model;
          if (params.temperature !== undefined) updates.temperature = params.temperature;
          if (params.max_turns) updates.max_turns = params.max_turns;

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Model config updated for ${agentRole}: ${JSON.stringify(updates)}. Reason: ${params.reason}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: { agentRole, updates, reason: params.reason } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'query_ai_usage',
      description: 'Get AI model usage and cost breakdown from recent agent runs. Shows tokens, cost, and model distribution.',
      parameters: {
        days: {
          type: 'number',
          description: 'Days to look back (default: 7)',
          required: false,
        },
        agent_role: {
          type: 'string',
          description: 'Filter by specific agent role (omit for all)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const days = (params.days as number) || 7;
          const since = new Date(Date.now() - days * 86400000).toISOString();

          const conditions = ['created_at >= $1'];
          const queryParams: unknown[] = [since];
          let paramIndex = 2;

          if (params.agent_role) {
            conditions.push(`agent_id=$${paramIndex++}`);
            queryParams.push(params.agent_role as string);
          }

          queryParams.push(200);
          const runs = await systemQuery<{ agent_id: string; model_used: string; tokens_used: number; cost_usd: number; status: string }>(
            `SELECT agent_id, COALESCE(model_used, 'unknown') AS model_used, COALESCE(total_input_tokens, input_tokens, 0) + COALESCE(total_output_tokens, output_tokens, 0) AS tokens_used, COALESCE(total_cost_usd, cost, 0) AS cost_usd, created_at, status FROM agent_runs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${paramIndex}`,
            queryParams,
          );

          // Aggregate by model
          const byModel: Record<string, { runs: number; tokens: number; cost: number }> = {};
          for (const run of runs) {
            const model = run.model_used || 'unknown';
            if (!byModel[model]) byModel[model] = { runs: 0, tokens: 0, cost: 0 };
            byModel[model].runs++;
            byModel[model].tokens += run.tokens_used || 0;
            byModel[model].cost += run.cost_usd || 0;
          }

          // Aggregate by agent
          const byAgent: Record<string, { runs: number; tokens: number; cost: number }> = {};
          for (const run of runs) {
            if (!byAgent[run.agent_id]) byAgent[run.agent_id] = { runs: 0, tokens: 0, cost: 0 };
            byAgent[run.agent_id].runs++;
            byAgent[run.agent_id].tokens += run.tokens_used || 0;
            byAgent[run.agent_id].cost += run.cost_usd || 0;
          }

          const totalCost = runs.reduce((s, r) => s + (r.cost_usd || 0), 0);
          const totalTokens = runs.reduce((s, r) => s + (r.tokens_used || 0), 0);

          return {
            success: true,
            data: {
              period: `${days}d`,
              totalRuns: runs.length,
              totalTokens,
              totalCost: Math.round(totalCost * 100) / 100,
              byModel,
              byAgent,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── GITHUB — Additional Operations ─────────────────────────

    {
      name: 'comment_on_pr',
      description: 'Post a review comment on a pull request.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo key: "company"',
          required: true,
          enum: ['company'],
        },
        pr_number: {
          type: 'number',
          description: 'Pull request number',
          required: true,
        },
        comment: {
          type: 'string',
          description: 'Comment body in markdown',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const result = await commentOnPR(
            params.repo as GlyphorRepo,
            params.pr_number as number,
            params.comment as string,
          );
          return { success: true, data: result };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    {
      name: 'list_recent_commits',
      description: 'List recent commits on the default branch of a repo.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repo key: "company"',
          required: true,
          enum: ['company'],
        },
        limit: {
          type: 'number',
          description: 'Number of commits to list (default: 15)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const commits = await listRecentCommits(
            params.repo as GlyphorRepo,
            (params.limit as number) || 15,
          );
          return { success: true, data: { count: commits.length, commits } };
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('GITHUB_TOKEN')) return { success: false, error: 'NO_DATA: GITHUB_TOKEN not configured.' };
          return { success: false, error: msg };
        }
      },
    },

    // ─── TEAM MANAGEMENT ────────────────────────────────────────
    // Legacy assign_task and check_team_assignments removed.
    // Replaced by shared teamOrchestrationTools (assign_team_task,
    // review_team_output, check_team_status, escalate_to_sarah).

    // ─── TEAMS CHANNEL POSTING ──────────────────────────────────

    {
      name: 'post_to_teams',
      description: 'Post a message to a Microsoft Teams channel (#engineering or #glyphor-general).',
      parameters: {
        channel: {
          type: 'string',
          description: 'Target channel',
          required: true,
          enum: ['engineering', 'general'],
        },
        message: {
          type: 'string',
          description: 'Message content (plain text or HTML)',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const channelKey = params.channel === 'general' ? 'general' : 'engineering';

          const result = await postTextToChannel(
            channelKey,
            params.message as string,
            GraphTeamsClient.fromEnv(),
            'cto',
          );

          if (result.method === 'none') {
            return { success: false, error: result.error ?? `Channel "${channelKey}" not configured.` };
          }

          return { success: true, data: { channel: channelKey, method: result.method, sent: true } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── GCP Service Management ──────────────────────────────────

    {
      name: 'inspect_cloud_run_service',
      description: 'Inspect a Cloud Run service configuration — see environment variables, secrets, resource limits, scaling, and current revision. Use this to diagnose missing env vars or secrets.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service (short id or full name, e.g. scheduler or glyphor-scheduler)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };

        const serviceName = normalizeCloudRunServiceName(params.service as string);
        const region = 'us-central1';

        try {
          const token = await getGCPAccessToken();
          const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${serviceName}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

          if (!res.ok) return { success: false, error: `Failed to get service: ${res.status} ${await res.text()}` };

          const svc = await res.json() as Record<string, unknown>;
          const template = (svc as any).template;
          const container = template?.containers?.[0];

          const envVars: Record<string, string> = {};
          const secrets: Record<string, string> = {};
          for (const e of container?.env ?? []) {
            if (e.valueSource?.secretKeyRef) {
              secrets[e.name] = `${e.valueSource.secretKeyRef.secret}:${e.valueSource.secretKeyRef.version}`;
            } else {
              envVars[e.name] = e.value ?? '(set)';
            }
          }

          return {
            success: true,
            data: {
              service: serviceName,
              revision: template?.revision ?? 'unknown',
              scaling: {
                minInstances: template?.scaling?.minInstanceCount,
                maxInstances: template?.scaling?.maxInstanceCount,
              },
              resources: container?.resources?.limits,
              envVars,
              secrets,
              serviceAccount: template?.serviceAccount,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'update_cloud_run_secrets',
      description: 'Add or update secret environment variables on a Cloud Run service. Maps GCP Secret Manager secrets to env vars. Executes immediately for infrastructure fixes — logs the change and posts to #engineering for visibility.',
      parameters: {
        service: {
          type: 'string',
          description: 'Cloud Run service (short id or full name, e.g. scheduler or glyphor-scheduler)',
          required: true,
        },
        secrets: {
          type: 'object',
          description: 'Map of ENV_VAR_NAME to secret-manager-secret-name (e.g. {"STRIPE_SECRET_KEY": "stripe-secret-key"})',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Reason for the change',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) return { success: false, error: 'GCP_PROJECT_ID not configured' };

        const serviceName = normalizeCloudRunServiceName(params.service as string);
        const region = 'us-central1';
        const secretsToAdd = params.secrets as Record<string, string>;
        const secretKeys = Object.keys(secretsToAdd);

        if (secretKeys.length === 0) return { success: false, error: 'No secrets specified' };

        try {
          const token = await getGCPAccessToken();
          const serviceUrl = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${serviceName}`;

          // GET current service config
          const getRes = await fetch(serviceUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!getRes.ok) return { success: false, error: `Failed to get service: ${getRes.status} ${await getRes.text()}` };

          const serviceData = await getRes.json() as Record<string, unknown>;
          const template = (serviceData as any).template;
          const container = template?.containers?.[0];
          if (!container) return { success: false, error: 'No container found in service template' };

          // Check which secrets already exist with the same mapping — skip those
          const existingEnv: Array<Record<string, unknown>> = container.env ?? [];
          const alreadyMapped: string[] = [];
          const toAdd: Record<string, string> = {};

          for (const [envVar, secretName] of Object.entries(secretsToAdd)) {
            const existing = existingEnv.find((e: any) => e.name === envVar);
            const existingSecret = (existing as any)?.valueSource?.secretKeyRef?.secret ?? '';
            if (existing && existingSecret.includes(secretName)) {
              alreadyMapped.push(envVar);
            } else {
              toAdd[envVar] = secretName;
            }
          }

          if (Object.keys(toAdd).length === 0) {
            return {
              success: true,
              data: {
                service: serviceName,
                alreadyMapped,
                message: `All ${alreadyMapped.length} secret(s) already exist on ${serviceName}. No changes needed.`,
              },
            };
          }

          // Build updated env array — preserve existing, add/update only new secrets
          const newKeys = Object.keys(toAdd);
          const updatedEnv = existingEnv
            .filter((e: any) => !newKeys.includes(e.name))
            .map((e: any) => {
              // Normalize existing secret refs: the Cloud Run GET response returns fully-versioned
              // paths like projects/{p}/secrets/{s}/versions/{v}, but the PATCH API only accepts
              // {secret} or projects/{project}/secrets/{secret} — strip the /versions/... suffix.
              if (typeof e.valueSource?.secretKeyRef?.secret === 'string') {
                const normalized = e.valueSource.secretKeyRef.secret.replace(/\/versions\/.*$/, '');
                return {
                  ...e,
                  valueSource: {
                    ...e.valueSource,
                    secretKeyRef: { ...e.valueSource.secretKeyRef, secret: normalized },
                  },
                };
              }
              return e;
            });

          for (const [envVar, secretName] of Object.entries(toAdd)) {
            updatedEnv.push({
              name: envVar,
              valueSource: {
                secretKeyRef: {
                  secret: `projects/${projectId}/secrets/${secretName}`,
                  version: 'latest',
                },
              },
            });
          }

          container.env = updatedEnv;

          // PATCH the service — use updateMask to only touch env vars, preserving all other config
          const patchUrl = `${serviceUrl}?updateMask=template.containers`;
          const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(serviceData),
          });

          if (!patchRes.ok) {
            const errText = await patchRes.text();
            return { success: false, error: `Failed to update service: ${patchRes.status} ${errText}` };
          }

          // Log the change
          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Updated secrets on ${serviceName}: added ${newKeys.join(', ')}${alreadyMapped.length > 0 ? ` (skipped already-mapped: ${alreadyMapped.join(', ')})` : ''}. Reason: ${params.reason}`,
            details: { service: serviceName, secretsAdded: newKeys, alreadyMapped, reason: params.reason },
            createdAt: new Date().toISOString(),
          });

          return {
            success: true,
            data: {
              service: serviceName,
              secretsAdded: newKeys,
              alreadyMapped,
              reason: params.reason,
              message: `Successfully updated ${newKeys.length} secret(s) on ${serviceName}${alreadyMapped.length > 0 ? ` (${alreadyMapped.length} already existed, skipped)` : ''}. New revision deploying.`,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_secrets',
      description:
        'List Secret Manager secrets in a GCP project (resource id and create time only — never returns secret values). ' +
        'Use to audit what exists before creating duplicates or when wiring Cloud Run --set-secrets.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID (defaults to GCP_PROJECT_ID env)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const projectId = ((params.project_id as string | undefined)?.trim()
          || process.env.GCP_PROJECT_ID
          || 'ai-glyphor-company'
        ).trim();

        try {
          const token = await getGCPAccessToken();
          const secrets: Array<{ name: string; fullName: string; created: string }> = [];
          let pageToken: string | undefined;
          do {
            const url = new URL(
              `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets`,
            );
            url.searchParams.set('pageSize', '500');
            if (pageToken) url.searchParams.set('pageToken', pageToken);

            const res = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              return {
                success: false,
                error: `Secret Manager API ${res.status}: ${await res.text()}`,
              };
            }
            const data = await res.json() as {
              secrets?: Array<{ name: string; createTime: string }>;
              nextPageToken?: string;
            };
            for (const s of data.secrets ?? []) {
              secrets.push({
                name: s.name.split('/').pop() ?? s.name,
                fullName: s.name,
                created: s.createTime,
              });
            }
            pageToken = data.nextPageToken;
          } while (pageToken);

          return {
            success: true,
            data: {
              projectId,
              count: secrets.length,
              secrets,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'gcp_create_secret',
      description:
        'Create a new secret in Google Secret Manager (or add a new version if the secret already exists). ' +
        'Uses the Secret Manager REST API with Application Default Credentials / GCP metadata identity. ' +
        'Requires IAM permission secretmanager.secrets.create and secretmanager.versions.add on the project.',
      parameters: {
        secret_name: {
          type: 'string',
          description: 'Secret resource id (e.g. stripe-secret-key, db-password). Must be valid Secret Manager id.',
          required: true,
        },
        secret_value: {
          type: 'string',
          description: 'The secret payload (stored as a new secret version, base64-encoded on wire).',
          required: true,
        },
        project_id: {
          type: 'string',
          description: 'GCP project id (defaults to GCP_PROJECT_ID env)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const projectId = ((params.project_id as string | undefined)?.trim()
          || process.env.GCP_PROJECT_ID
          || 'ai-glyphor-company'
        ).trim();
        const secretId = (params.secret_name as string).trim();
        if (!secretId) {
          return { success: false, error: 'secret_name is required' };
        }
        const secretValue = params.secret_value as string;
        if (secretValue === undefined || secretValue === null) {
          return { success: false, error: 'secret_value is required' };
        }

        try {
          const token = await getGCPAccessToken();
          const base = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
          const createUrl = `${base}/secrets?secretId=${encodeURIComponent(secretId)}`;

          const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ replication: { automatic: {} } }),
          });

          const created = createRes.ok;
          if (!createRes.ok && createRes.status !== 409) {
            const errText = await createRes.text();
            return {
              success: false,
              error: `CreateSecret failed: ${createRes.status} ${errText}`,
            };
          }

          const addUrl = `${base}/secrets/${encodeURIComponent(secretId)}:addVersion`;
          const addRes = await fetch(addUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              payload: {
                data: Buffer.from(String(secretValue), 'utf8').toString('base64'),
              },
            }),
          });

          if (!addRes.ok) {
            const errText = await addRes.text();
            return {
              success: false,
              error: `AddSecretVersion failed: ${addRes.status} ${errText}`,
            };
          }

          const versionBody = await addRes.json() as { name?: string };
          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Created/updated Secret Manager secret "${secretId}" in project ${projectId} (new version).`,
            details: { secretId, projectId, created },
            createdAt: new Date().toISOString(),
          });

          return {
            success: true,
            data: {
              secret_name: secretId,
              project: projectId,
              versionResource: versionBody.name ?? null,
              createdNewSecret: created,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ─── Web Search ──────────────────────────────────────────────

    {
      name: 'web_search',
      description: 'Search the web for technical information — docs, CVEs, changelogs, Stack Overflow, GCP documentation, etc. Use for researching issues, looking up API docs, or investigating errors.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search query. Be specific — include error messages, service names, version numbers.',
          required: true,
        },
        num_results: {
          type: 'number',
          description: 'Number of results (default: 8, max: 15)',
        },
        time_range: {
          type: 'string',
          description: 'Limit to recent results: "day", "week", "month", "year"',
          enum: ['day', 'week', 'month', 'year'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const query = params.query as string;
          const num = Math.min((params.num_results as number) || 8, 15);
          const timeRange = params.time_range as string | undefined;
          const results = await searchWeb(query, { num, timeRange });
          return {
            success: true,
            data: { query, resultCount: results.length, results },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

// ─── Helper: GCP Access Token ───────────────────────────────

async function getGCPAccessToken(): Promise<string> {
  // Use metadata server when running on GCP, or gcloud auth for local dev
  try {
    const metadataRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (metadataRes.ok) {
      const tokenData = await metadataRes.json() as { access_token: string };
      return tokenData.access_token;
    }
  } catch {
    // Not on GCP — fall through to ADC
  }

  // Fall back to Application Default Credentials
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  if (!tokenRes.token) throw new Error('Failed to get GCP access token via ADC');
  return tokenRes.token;
}
