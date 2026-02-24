/**
 * CTO — Tool Definitions
 *
 * Tools for: platform health checks, deployment management,
 * cost optimization, and technical analysis.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
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
        const alertEvents = activity.filter(a => a.action === 'alert');

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
      description: 'Get detailed Cloud Run metrics (request count, latency, error rate, instance count) for a specific service.',
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
        const totalInfra = financials.reduce((s, f) => s + f.infraCost, 0);
        const totalApi = financials.reduce((s, f) => s + f.apiCost, 0);
        return {
          success: true,
          data: {
            period: `${days} days`,
            totalInfraCost: totalInfra,
            totalApiCost: totalApi,
            dailySnapshots: financials,
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
  ];
}
