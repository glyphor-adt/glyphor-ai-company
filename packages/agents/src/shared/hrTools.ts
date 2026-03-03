/**
 * HR Tools — Shared tools for human-resources operations
 *
 * Tools:
 *   get_org_chart                — Read org structure with optional department filter
 *   update_agent_profile         — Update a field on an agent's profile
 *   get_agent_directory          — List agents with optional department/status filters
 *   create_onboarding_plan       — Create an onboarding checklist for a new agent
 *   get_agent_performance_summary — Pull performance metrics for an agent
 *   create_performance_review    — Compile a structured performance review
 *   run_engagement_survey        — Create an engagement survey
 *   get_team_dynamics            — Analyze inter-agent collaboration patterns
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createHRTools(): ToolDefinition[] {
  return [
    /* ── get_org_chart ─────────────────────── */
    {
      name: 'get_org_chart',
      description:
        'Read the organisational structure. Returns agents with their reporting hierarchy. ' +
        'Optionally filter by department to see a single team tree.',
      parameters: {
        department: {
          type: 'string',
          description: 'Optional: filter by department (e.g. "engineering", "finance", "marketing")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions = ['1=1'];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          if (params.department) {
            conditions.push(`a.department = $${paramIndex++}`);
            queryParams.push(params.department as string);
          }

          const rows = await systemQuery<{
            role: string;
            display_name: string;
            title: string;
            department: string;
            reports_to: string | null;
            status: string;
            manager_name: string | null;
          }>(
            `SELECT a.role, a.display_name, a.title, a.department, a.reports_to, a.status,
                    m.display_name AS manager_name
             FROM company_agents a
             LEFT JOIN company_agents m ON a.reports_to = m.role
             WHERE ${conditions.join(' AND ')}
             ORDER BY a.department, a.reports_to NULLS FIRST, a.role`,
            queryParams,
          );

          const agents = (rows ?? []).map((r) => ({
            role: r.role,
            name: r.display_name,
            title: r.title,
            department: r.department,
            reports_to: r.reports_to ?? null,
            manager_name: r.manager_name ?? null,
            status: r.status,
          }));

          return {
            success: true,
            data: { count: agents.length, org_tree: agents },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── update_agent_profile ──────────────── */
    {
      name: 'update_agent_profile',
      description:
        'Update a single field on an agent profile. Performs a read-after-write verification ' +
        'to confirm the change persisted.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Role slug of the agent to update (e.g. "cto", "vp-sales")',
          required: true,
        },
        field: {
          type: 'string',
          description: 'Column name to update (e.g. "status", "department", "title")',
          required: true,
        },
        value: {
          type: 'string',
          description: 'New value to set for the field',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const field = params.field as string;
        const value = params.value as string;

        // Allow-list of updatable columns to prevent SQL injection
        const allowedFields = [
          'display_name', 'title', 'department', 'status',
          'reports_to', 'is_core',
        ];
        if (!allowedFields.includes(field)) {
          return {
            success: false,
            error: `Field "${field}" is not updatable. Allowed fields: ${allowedFields.join(', ')}`,
          };
        }

        try {
          await systemQuery(
            `UPDATE company_agents SET ${field} = $1 WHERE role = $2`,
            [value, agentRole],
          );

          // Read-after-write verification
          const rows = await systemQuery<Record<string, unknown>>(
            'SELECT role, display_name, title, department, status, reports_to, is_core FROM company_agents WHERE role = $1 LIMIT 1',
            [agentRole],
          );

          if (!rows || rows.length === 0) {
            return { success: false, error: `Agent "${agentRole}" not found` };
          }

          return {
            success: true,
            data: { updated_field: field, agent: rows[0] },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── get_agent_directory ───────────────── */
    {
      name: 'get_agent_directory',
      description:
        'List all agents in the company directory with optional department and status filters.',
      parameters: {
        department: {
          type: 'string',
          description: 'Optional: filter by department',
          required: false,
        },
        status: {
          type: 'string',
          description: 'Optional: filter by status (e.g. "active", "inactive")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const queryParams: unknown[] = [];
          let paramIndex = 1;

          if (params.department) {
            conditions.push(`department = $${paramIndex++}`);
            queryParams.push(params.department as string);
          }
          if (params.status) {
            conditions.push(`status = $${paramIndex++}`);
            queryParams.push(params.status as string);
          }

          const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

          const rows = await systemQuery<{
            role: string;
            display_name: string;
            title: string;
            department: string;
            status: string;
            reports_to: string | null;
            is_core: boolean;
          }>(
            `SELECT role, display_name, title, department, status, reports_to, is_core
             FROM company_agents ${whereClause}
             ORDER BY department, is_core DESC, role`,
            queryParams,
          );

          const agents = (rows ?? []).map((a) => ({
            role: a.role,
            name: a.display_name,
            title: a.title,
            department: a.department,
            status: a.status,
            reports_to: a.reports_to ?? null,
            is_executive: a.is_core,
          }));

          return {
            success: true,
            data: { count: agents.length, agents },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── create_onboarding_plan ────────────── */
    {
      name: 'create_onboarding_plan',
      description:
        'Create an onboarding checklist for a new agent. Logs the plan to activity_log and ' +
        'returns a structured milestone-based onboarding plan.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Role slug of the agent being onboarded',
          required: true,
        },
        department: {
          type: 'string',
          description: 'Department the agent belongs to',
          required: true,
        },
        mentor: {
          type: 'string',
          description: 'Optional: role slug of the assigned mentor',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const department = params.department as string;
        const mentor = (params.mentor as string) ?? null;

        const milestones = [
          { day: 1, task: 'System access provisioned and credentials verified' },
          { day: 1, task: 'Introduction to team members and key stakeholders' },
          { day: 3, task: 'Review department processes and documentation' },
          { day: 7, task: 'Complete first supervised task with mentor review' },
          { day: 14, task: 'Handle independent task with quality review' },
          { day: 30, task: 'Full autonomy checkpoint — performance baseline set' },
        ];

        const plan = {
          agent_role: agentRole,
          department,
          mentor,
          milestones,
          created_at: new Date().toISOString(),
        };

        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              agentRole,
              agentRole,
              'onboarding_plan',
              JSON.stringify(plan),
              plan.created_at,
            ],
          );

          return {
            success: true,
            data: plan,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── get_agent_performance_summary ─────── */
    {
      name: 'get_agent_performance_summary',
      description:
        'Pull performance data for an agent: run count, success rate from agent_runs, ' +
        'and trust score data from agent_trust_scores.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Role slug of the agent to evaluate',
          required: true,
        },
        date_range: {
          type: 'string',
          description: 'Time window for the performance data',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const dateRange = params.date_range as string;
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date(Date.now() - days * 86400000).toISOString();

        try {
          const runStats = await systemQuery<{
            total_runs: number;
            successful_runs: number;
            failed_runs: number;
          }>(
            `SELECT
               COUNT(*)::int AS total_runs,
               COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
               COUNT(*) FILTER (WHERE status = 'error')::int AS failed_runs
             FROM agent_runs
             WHERE agent_role = $1 AND started_at >= $2`,
            [agentRole, since],
          );

          const trustData = await systemQuery<{
            overall_score: number;
            evaluated_at: string;
          }>(
            `SELECT overall_score, evaluated_at
             FROM agent_trust_scores
             WHERE agent_role = $1
             ORDER BY evaluated_at DESC LIMIT 1`,
            [agentRole],
          );

          const stats = runStats?.[0] ?? { total_runs: 0, successful_runs: 0, failed_runs: 0 };
          const successRate = stats.total_runs > 0
            ? Math.round((stats.successful_runs / stats.total_runs) * 100)
            : 0;

          return {
            success: true,
            data: {
              agent_role: agentRole,
              period: dateRange,
              runs: {
                total: stats.total_runs,
                successful: stats.successful_runs,
                failed: stats.failed_runs,
                success_rate_pct: successRate,
              },
              trust: trustData?.[0]
                ? {
                    overall_score: trustData[0].overall_score,
                    last_evaluated: trustData[0].evaluated_at,
                  }
                : null,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── create_performance_review ─────────── */
    {
      name: 'create_performance_review',
      description:
        'Compile a structured performance review for an agent by aggregating data from ' +
        'agent_runs, agent_trust_scores, and agent_peer_feedback.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Role slug of the agent to review',
          required: true,
        },
        review_period: {
          type: 'string',
          description: 'Review period to compile',
          required: true,
          enum: ['monthly', 'quarterly', 'annual'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const period = params.review_period as string;
        const days = period === 'monthly' ? 30 : period === 'quarterly' ? 90 : 365;
        const since = new Date(Date.now() - days * 86400000).toISOString();

        try {
          const runStats = await systemQuery<{
            total_runs: number;
            successful_runs: number;
            avg_duration_ms: number;
          }>(
            `SELECT
               COUNT(*)::int AS total_runs,
               COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
               AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::int AS avg_duration_ms
             FROM agent_runs
             WHERE agent_role = $1 AND started_at >= $2`,
            [agentRole, since],
          );

          const trustData = await systemQuery<{
            overall_score: number;
            reliability: number;
            accuracy: number;
            evaluated_at: string;
          }>(
            `SELECT overall_score, reliability, accuracy, evaluated_at
             FROM agent_trust_scores
             WHERE agent_role = $1 AND evaluated_at >= $2
             ORDER BY evaluated_at DESC LIMIT 1`,
            [agentRole, since],
          );

          const peerFeedback = await systemQuery<{
            from_agent: string;
            rating: number;
            feedback: string;
            created_at: string;
          }>(
            `SELECT from_agent, rating, feedback, created_at
             FROM agent_peer_feedback
             WHERE to_agent = $1 AND created_at >= $2
             ORDER BY created_at DESC`,
            [agentRole, since],
          );

          const stats = runStats?.[0] ?? { total_runs: 0, successful_runs: 0, avg_duration_ms: 0 };
          const successRate = stats.total_runs > 0
            ? Math.round((stats.successful_runs / stats.total_runs) * 100)
            : 0;

          const feedbackItems = (peerFeedback ?? []).map((f) => ({
            from: f.from_agent,
            rating: f.rating,
            feedback: f.feedback,
            date: f.created_at,
          }));

          const avgPeerRating = feedbackItems.length > 0
            ? Math.round((feedbackItems.reduce((s, f) => s + f.rating, 0) / feedbackItems.length) * 10) / 10
            : null;

          return {
            success: true,
            data: {
              agent_role: agentRole,
              review_period: period,
              period_start: since,
              execution: {
                total_runs: stats.total_runs,
                successful_runs: stats.successful_runs,
                success_rate_pct: successRate,
                avg_duration_ms: stats.avg_duration_ms,
              },
              trust: trustData?.[0]
                ? {
                    overall_score: trustData[0].overall_score,
                    reliability: trustData[0].reliability,
                    accuracy: trustData[0].accuracy,
                    last_evaluated: trustData[0].evaluated_at,
                  }
                : null,
              peer_feedback: {
                count: feedbackItems.length,
                avg_rating: avgPeerRating,
                items: feedbackItems,
              },
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── run_engagement_survey ─────────────── */
    {
      name: 'run_engagement_survey',
      description:
        'Create an engagement survey by logging it to activity_log. Returns a survey_id ' +
        'that can be referenced when collecting responses.',
      parameters: {
        title: {
          type: 'string',
          description: 'Title of the engagement survey',
          required: true,
        },
        questions: {
          type: 'string',
          description: 'JSON array of survey questions (e.g. \'["How satisfied are you?", "What can improve?"]\')',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const title = params.title as string;
        const questionsRaw = params.questions as string;

        let parsedQuestions: string[];
        try {
          parsedQuestions = JSON.parse(questionsRaw);
          if (!Array.isArray(parsedQuestions)) {
            return { success: false, error: 'questions must be a JSON array of strings' };
          }
        } catch {
          return { success: false, error: 'Invalid JSON in questions parameter' };
        }

        const surveyId = `survey-${Date.now()}`;
        const now = new Date().toISOString();
        const survey = {
          survey_id: surveyId,
          title,
          questions: parsedQuestions,
          created_at: now,
        };

        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              'hr',
              'hr',
              'engagement_survey',
              JSON.stringify(survey),
              now,
            ],
          );

          return {
            success: true,
            data: { survey_id: surveyId, title, question_count: parsedQuestions.length },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── get_team_dynamics ─────────────────── */
    {
      name: 'get_team_dynamics',
      description:
        'Analyze inter-agent communication and collaboration patterns. Queries activity_log ' +
        'for interaction volume and returns collaboration metrics.',
      parameters: {
        department: {
          type: 'string',
          description: 'Optional: filter to a specific department',
          required: false,
        },
        date_range: {
          type: 'string',
          description: 'Time window for the analysis',
          required: true,
          enum: ['7d', '30d', '90d'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const dateRange = params.date_range as string;
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const since = new Date(Date.now() - days * 86400000).toISOString();

        try {
          const conditions = ['m.created_at >= $1'];
          const queryParams: unknown[] = [since];
          let paramIndex = 2;

          if (params.department) {
            conditions.push(
              `(s.department = $${paramIndex} OR r.department = $${paramIndex})`,
            );
            queryParams.push(params.department as string);
            paramIndex++;
          }

          const messagePairs = await systemQuery<{
            from_agent: string;
            to_agent: string;
            message_count: number;
          }>(
            `SELECT m.from_agent, m.to_agent, COUNT(*)::int AS message_count
             FROM agent_messages m
             LEFT JOIN company_agents s ON m.from_agent = s.role
             LEFT JOIN company_agents r ON m.to_agent = r.role
             WHERE ${conditions.join(' AND ')}
             GROUP BY m.from_agent, m.to_agent
             ORDER BY message_count DESC
             LIMIT 50`,
            queryParams,
          );

          const activityStats = await systemQuery<{
            agent_role: string;
            action_count: number;
          }>(
            `SELECT al.agent_role, COUNT(*)::int AS action_count
             FROM activity_log al
             ${params.department ? 'JOIN company_agents ca ON al.agent_role = ca.role' : ''}
             WHERE al.created_at >= $1
             ${params.department ? `AND ca.department = $${paramIndex}` : ''}
             GROUP BY al.agent_role
             ORDER BY action_count DESC`,
            params.department ? [since, params.department as string] : [since],
          );

          const pairs = (messagePairs ?? []).map((p) => ({
            from: p.from_agent,
            to: p.to_agent,
            messages: p.message_count,
          }));

          const activity = (activityStats ?? []).map((a) => ({
            agent: a.agent_role,
            actions: a.action_count,
          }));

          const totalMessages = pairs.reduce((sum, p) => sum + p.messages, 0);

          return {
            success: true,
            data: {
              period: dateRange,
              total_messages: totalMessages,
              top_communication_pairs: pairs,
              agent_activity: activity,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
