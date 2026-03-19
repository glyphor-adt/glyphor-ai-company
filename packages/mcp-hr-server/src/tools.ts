import type { Pool } from 'pg';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (pool: Pool, params: Record<string, unknown>) => Promise<unknown>;
}

function parseDateRange(range: string): Date {
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  const d = days[range] ?? 30;
  return new Date(Date.now() - d * 86_400_000);
}

function periodDays(period: string): number {
  const map: Record<string, number> = { monthly: 30, quarterly: 90, annual: 365 };
  return map[period] ?? 30;
}

export const tools: ToolDefinition[] = [
  // ── Org Chart ────────────────────────────────────────────
  {
    name: 'get_org_chart',
    description:
      'Read the organisational structure. Returns agents with their reporting hierarchy. Optionally filter by department to see a single team tree.',
    inputSchema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Filter by department (e.g. "engineering", "finance", "marketing").',
        },
      },
    },
    async handler(pool, params) {
      const conditions = ['1=1'];
      const values: unknown[] = [];
      if (params.department) {
        values.push(params.department);
        conditions.push(`a.department = $${values.length}`);
      }
      const { rows } = await pool.query(
        `SELECT a.role, a.display_name, a.title, a.department, a.reports_to, a.status,
                m.display_name AS manager_name
         FROM company_agents a
         LEFT JOIN company_agents m ON a.reports_to = m.role
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.department, a.reports_to NULLS FIRST, a.role`,
        values,
      );
      return {
        count: rows.length,
        org_tree: rows.map((r: Record<string, unknown>) => ({
          role: r.role,
          name: r.display_name,
          title: r.title,
          department: r.department,
          reports_to: r.reports_to,
          manager_name: r.manager_name,
          status: r.status,
        })),
      };
    },
  },

  // ── Agent Directory ──────────────────────────────────────
  {
    name: 'get_agent_directory',
    description: 'List all agents in the company directory with optional department and status filters.',
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Filter by department.' },
        status: { type: 'string', description: 'Filter by status (e.g. "active", "inactive").' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.department) {
        values.push(params.department);
        conditions.push(`department = $${values.length}`);
      }
      if (params.status) {
        values.push(params.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT role, display_name, title, department, status, reports_to, is_core
         FROM company_agents ${where}
         ORDER BY department, is_core DESC, role`,
        values,
      );
      return {
        count: rows.length,
        agents: rows.map((r: Record<string, unknown>) => ({
          role: r.role,
          name: r.display_name,
          title: r.title,
          department: r.department,
          status: r.status,
          reports_to: r.reports_to,
          is_executive: r.is_core,
        })),
      };
    },
  },

  // ── Performance Summary ──────────────────────────────────
  {
    name: 'get_agent_performance_summary',
    description:
      'Pull performance data for an agent: run count, success rate from agent_runs, and trust score from agent_trust_scores.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Role slug of the agent to evaluate.' },
        date_range: { type: 'string', description: 'Time window.', enum: ['7d', '30d', '90d'] },
      },
      required: ['agent_role', 'date_range'],
    },
    async handler(pool, params) {
      const agentRole = params.agent_role as string;
      const since = parseDateRange(params.date_range as string);

      const [runsResult, trustResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS total_runs,
             COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
             COUNT(*) FILTER (WHERE status = 'error')::int AS failed_runs
           FROM agent_runs
           WHERE agent_role = $1 AND started_at >= $2`,
          [agentRole, since.toISOString()],
        ),
        pool.query(
          `SELECT overall_score, evaluated_at
           FROM agent_trust_scores
           WHERE agent_role = $1
           ORDER BY evaluated_at DESC LIMIT 1`,
          [agentRole],
        ),
      ]);

      const r = runsResult.rows[0] as Record<string, number>;
      const t = trustResult.rows[0] as Record<string, unknown> | undefined;

      return {
        agent_role: agentRole,
        period: params.date_range,
        runs: {
          total: r.total_runs,
          successful: r.successful_runs,
          failed: r.failed_runs,
          success_rate_pct: r.total_runs > 0 ? Math.round((r.successful_runs / r.total_runs) * 100) : 0,
        },
        trust: t
          ? { overall_score: t.overall_score, last_evaluated: t.evaluated_at }
          : null,
      };
    },
  },

  // ── Performance Review ───────────────────────────────────
  {
    name: 'create_performance_review',
    description:
      'Compile a structured performance review for an agent by aggregating data from agent_runs, agent_trust_scores, and agent_peer_feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Role slug of the agent to review.' },
        review_period: { type: 'string', description: 'Review period.', enum: ['monthly', 'quarterly', 'annual'] },
      },
      required: ['agent_role', 'review_period'],
    },
    async handler(pool, params) {
      const agentRole = params.agent_role as string;
      const period = params.review_period as string;
      const since = new Date(Date.now() - periodDays(period) * 86_400_000).toISOString();

      const [runsResult, trustResult, feedbackResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS total_runs,
             COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
             AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::int AS avg_duration_ms
           FROM agent_runs
           WHERE agent_role = $1 AND started_at >= $2`,
          [agentRole, since],
        ),
        pool.query(
          `SELECT overall_score, reliability, accuracy, evaluated_at
           FROM agent_trust_scores
           WHERE agent_role = $1 AND evaluated_at >= $2
           ORDER BY evaluated_at DESC LIMIT 1`,
          [agentRole, since],
        ),
        pool.query(
          `SELECT from_agent, rating, feedback, created_at
           FROM agent_peer_feedback
           WHERE to_agent = $1 AND created_at >= $2
           ORDER BY created_at DESC`,
          [agentRole, since],
        ),
      ]);

      const r = runsResult.rows[0] as Record<string, number>;
      const t = trustResult.rows[0] as Record<string, unknown> | undefined;
      const fb = feedbackResult.rows as Array<Record<string, unknown>>;
      const avgRating = fb.length
        ? Math.round((fb.reduce((s, f) => s + Number(f.rating ?? 0), 0) / fb.length) * 10) / 10
        : null;

      return {
        agent_role: agentRole,
        review_period: period,
        period_start: since,
        execution: {
          total_runs: r.total_runs,
          successful_runs: r.successful_runs,
          success_rate_pct: r.total_runs > 0 ? Math.round((r.successful_runs / r.total_runs) * 100) : 0,
          avg_duration_ms: r.avg_duration_ms ?? 0,
        },
        trust: t
          ? {
              overall_score: t.overall_score,
              reliability: t.reliability,
              accuracy: t.accuracy,
              last_evaluated: t.evaluated_at,
            }
          : null,
        peer_feedback: {
          count: fb.length,
          avg_rating: avgRating,
          items: fb.map((f) => ({
            from: f.from_agent,
            rating: f.rating,
            feedback: f.feedback,
            date: f.created_at,
          })),
        },
      };
    },
  },

  // ── Team Dynamics ────────────────────────────────────────
  {
    name: 'get_team_dynamics',
    description:
      'Analyze inter-agent communication and collaboration patterns. Queries agent_messages for interaction volume and returns collaboration metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Filter to a specific department.' },
        date_range: { type: 'string', description: 'Time window.', enum: ['7d', '30d', '90d'] },
      },
      required: ['date_range'],
    },
    async handler(pool, params) {
      const since = parseDateRange(params.date_range as string).toISOString();
      const hasDept = !!params.department;

      // Communication pairs
      const msgValues: unknown[] = [since];
      let msgSql = `SELECT m.from_agent, m.to_agent, COUNT(*)::int AS message_count
         FROM agent_messages m`;
      if (hasDept) {
        msgSql += `
         LEFT JOIN company_agents s ON m.from_agent = s.role
         LEFT JOIN company_agents r ON m.to_agent = r.role`;
      }
      msgSql += `\n         WHERE m.created_at >= $1`;
      if (hasDept) {
        msgValues.push(params.department);
        msgSql += ` AND (s.department = $2 OR r.department = $2)`;
      }
      msgSql += `\n         GROUP BY m.from_agent, m.to_agent ORDER BY message_count DESC LIMIT 50`;

      // Activity stats
      const actValues: unknown[] = [since];
      let actSql = `SELECT al.agent_role, COUNT(*)::int AS action_count FROM activity_log al`;
      if (hasDept) {
        actSql += ` JOIN company_agents ca ON al.agent_role = ca.role`;
      }
      actSql += ` WHERE al.created_at >= $1`;
      if (hasDept) {
        actValues.push(params.department);
        actSql += ` AND ca.department = $2`;
      }
      actSql += ` GROUP BY al.agent_role ORDER BY action_count DESC`;

      const [msgResult, actResult] = await Promise.all([
        pool.query(msgSql, msgValues),
        pool.query(actSql, actValues),
      ]);

      const pairs = msgResult.rows as Array<Record<string, unknown>>;
      const totalMessages = pairs.reduce((s, p) => s + Number(p.message_count ?? 0), 0);

      return {
        period: params.date_range,
        total_messages: totalMessages,
        top_communication_pairs: pairs.map((p) => ({
          from: p.from_agent,
          to: p.to_agent,
          messages: p.message_count,
        })),
        agent_activity: (actResult.rows as Array<Record<string, unknown>>).map((a) => ({
          agent: a.agent_role,
          actions: a.action_count,
        })),
      };
    },
  },

  // ── Update Agent Profile ─────────────────────────────────
  {
    name: 'update_agent_profile',
    description:
      'Update a single field on an agent profile. Performs a read-after-write verification to confirm the change persisted.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Role slug of the agent to update (e.g. "cto", "vp-sales").' },
        field: { type: 'string', description: 'Column name to update.', enum: ['display_name', 'title', 'department', 'status', 'reports_to', 'is_core'] },
        value: { type: 'string', description: 'New value to set for the field.' },
      },
      required: ['agent_role', 'field', 'value'],
    },
    async handler(pool, params) {
      const agentRole = params.agent_role as string;
      const field = params.field as string;
      const value = params.value as string;

      // Allow-list of updatable columns to prevent SQL injection
      const allowedFields = ['display_name', 'title', 'department', 'status', 'reports_to', 'is_core'];
      if (!allowedFields.includes(field)) {
        throw new Error(`Field "${field}" is not updatable. Allowed fields: ${allowedFields.join(', ')}`);
      }

      await pool.query(
        `UPDATE company_agents SET ${field} = $1 WHERE role = $2`,
        [value, agentRole],
      );

      // Read-after-write verification
      const { rows } = await pool.query(
        'SELECT role, display_name, title, department, status, reports_to, is_core FROM company_agents WHERE role = $1 LIMIT 1',
        [agentRole],
      );

      if (rows.length === 0) {
        throw new Error(`Agent "${agentRole}" not found`);
      }

      return { updated_field: field, agent: rows[0] };
    },
  },

  // ── Create Onboarding Plan ───────────────────────────────
  {
    name: 'create_onboarding_plan',
    description:
      'Create an onboarding checklist for a new agent. Logs the plan to activity_log and returns a structured milestone-based onboarding plan.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Role slug of the agent being onboarded.' },
        department: { type: 'string', description: 'Department the agent belongs to.' },
        mentor: { type: 'string', description: 'Role slug of the assigned mentor.' },
      },
      required: ['agent_role', 'department'],
    },
    async handler(pool, params) {
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

      const now = new Date().toISOString();
      const plan = { agent_role: agentRole, department, mentor, milestones, created_at: now };

      await pool.query(
        `INSERT INTO activity_log (agent_role, action, summary)
         VALUES ($1, $2, $3)`,
        [agentRole, 'onboarding_plan', JSON.stringify(plan)],
      );

      return plan;
    },
  },

  // ── Run Engagement Survey ────────────────────────────────
  {
    name: 'run_engagement_survey',
    description:
      'Create an engagement survey by logging it to activity_log. Returns a survey_id that can be referenced when collecting responses.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the engagement survey.' },
        questions: { type: 'string', description: 'JSON array of survey questions (e.g. \'["How satisfied are you?", "What can improve?"]\').' },
      },
      required: ['title', 'questions'],
    },
    async handler(pool, params) {
      const title = params.title as string;
      const questionsRaw = params.questions as string;

      let parsedQuestions: string[];
      try {
        parsedQuestions = JSON.parse(questionsRaw);
        if (!Array.isArray(parsedQuestions)) {
          throw new Error('questions must be a JSON array of strings');
        }
      } catch (e) {
        throw new Error(`Invalid JSON in questions parameter: ${(e as Error).message}`);
      }

      const surveyId = `survey-${Date.now()}`;
      const now = new Date().toISOString();
      const survey = { survey_id: surveyId, title, questions: parsedQuestions, created_at: now };

      await pool.query(
        `INSERT INTO activity_log (agent_role, action, summary)
         VALUES ($1, $2, $3)`,
        ['hr', 'engagement_survey', JSON.stringify(survey)],
      );

      return { survey_id: surveyId, title, question_count: parsedQuestions.length };
    },
  },
];
