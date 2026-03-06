/**
 * HR Tools — Shared tools for human-resources write operations
 *
 * Read-only HR tools (org chart, directory, performance, team dynamics) are
 * now served via mcp-hr-server.
 *
 * Tools:
 *   update_agent_profile   — Update a field on an agent's profile
 *   create_onboarding_plan — Create an onboarding checklist for a new agent
 *   run_engagement_survey  — Create an engagement survey
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createHRTools(): ToolDefinition[] {
  return [
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
  ];
}
