/**
 * Team Orchestration Tools — Executive Team Management
 *
 * Tools for executive agents (CTO, CPO, CMO, etc.) to manage their direct reports:
 *   assign_team_task     — Decompose executive outcomes into team tasks
 *   review_team_output   — Accept, revise, or reassign team member work
 *   check_team_status    — Query all tasks assigned by this executive
 *   escalate_to_sarah    — Escalate cross-functional issues to Chief of Staff
 *
 * Direct reports are loaded dynamically from company_agents table.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Resolve direct reports dynamically from the database */
async function getDirectReports(executiveRole: string): Promise<string[]> {
  const rows = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE reports_to = $1 ORDER BY role',
    [executiveRole],
  );
  return (rows ?? []).map(r => r.role);
}

export function createTeamOrchestrationTools(
  glyphorEventBus: GlyphorEventBus,
): ToolDefinition[] {
  return [
    /* ── assign_team_task ─────────────────── */
    {
      name: 'assign_team_task',
      description:
        'Decompose an executive outcome into a task for one of your direct reports. ' +
        'Creates a work assignment linked to the parent assignment. Only assign to agents who report to you.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Role of your direct report to assign this task to',
          required: true,
        },
        task_description: {
          type: 'string',
          description: 'Clear description of what they need to do',
          required: true,
        },
        expected_output: {
          type: 'string',
          description: 'What you expect them to produce',
          required: true,
        },
        parent_assignment_id: {
          type: 'string',
          description: 'The executive outcome assignment this task supports (optional)',
          required: false,
        },
        priority: {
          type: 'string',
          description: 'Task priority',
          required: false,
          enum: ['urgent', 'high', 'normal', 'low'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const priority = (params.priority as string) || 'normal';
        const parentId = params.parent_assignment_id as string | undefined;

        try {
          // Validate: agent must be a direct report
          const directReports = await getDirectReports(ctx.agentRole);
          if (!directReports.includes(agentRole)) {
            return {
              success: false,
              error: `${agentRole} does not report to you. Your direct reports: ${directReports.join(', ') || 'none found'}`,
            };
          }

          // Pre-dispatch check: does this agent have capacity?
          const [activeCount] = await systemQuery<{ count: number }>(
            "SELECT COUNT(*)::int as count FROM work_assignments WHERE assigned_to = $1 AND status IN ('pending', 'in_progress')",
            [agentRole],
          );
          if (activeCount && activeCount.count > 5) {
            return {
              success: false,
              error: `${agentRole} already has ${activeCount.count} active assignments. Consider waiting or reassigning.`,
            };
          }

          // Create work assignment
          const insertFields = [
            'assigned_to', 'assigned_by', 'task_description', 'task_type',
            'expected_output', 'priority', 'status', 'assignment_type',
          ];
          const insertValues = [
            agentRole, ctx.agentRole, params.task_description as string,
            'team_task', params.expected_output as string, priority,
            'pending', 'team_task',
          ];

          if (parentId) {
            insertFields.push('parent_assignment_id');
            insertValues.push(parentId);
          }

          const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(',');
          const [assignment] = await systemQuery<{ id: string }>(
            `INSERT INTO work_assignments (${insertFields.join(',')}) VALUES (${placeholders}) RETURNING id`,
            insertValues,
          );

          // Send inter-agent message
          await systemQuery(
            'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              ctx.agentRole,
              agentRole,
              `**Task Assignment**\n\n` +
              `**Priority:** ${priority}\n\n` +
              `**Task:**\n${params.task_description}\n\n` +
              `**Expected Output:**\n${params.expected_output}\n\n` +
              `Use \`submit_assignment_output\` when complete, or \`flag_assignment_blocker\` if blocked.`,
              'task', priority === 'urgent' ? 'urgent' : 'normal', 'pending',
            ],
          );

          // Emit event for wake routing
          await glyphorEventBus.emit({
            type: 'assignment.created',
            source: ctx.agentRole,
            payload: {
              assignment_id: assignment.id,
              assigned_to: agentRole,
              assigned_by: ctx.agentRole,
              parent_assignment_id: parentId,
              priority,
            },
            priority: priority === 'urgent' ? 'high' : 'normal',
          });

          return {
            success: true,
            data: {
              assignment_id: assignment.id,
              assigned_to: agentRole,
              priority,
              parent_assignment_id: parentId ?? null,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── review_team_output ───────────────── */
    {
      name: 'review_team_output',
      description:
        'Review and evaluate completed work from a team member. ' +
        'Accept the output, request revisions, or reassign to another report.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'The assignment UUID to review',
          required: true,
        },
        action: {
          type: 'string',
          description: 'accept (mark done), revise (send back with feedback), or reassign',
          required: true,
          enum: ['accept', 'revise', 'reassign'],
        },
        evaluation: {
          type: 'string',
          description: 'Your evaluation comments or revision feedback',
          required: true,
        },
        quality_score: {
          type: 'number',
          description: 'Quality score 1-10 (required for accept)',
          required: false,
        },
        reassign_to: {
          type: 'string',
          description: 'Agent role to reassign to (required for reassign action)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const assignmentId = params.assignment_id as string;
        const action = params.action as string;
        const evaluation = params.evaluation as string;
        const qualityScore = params.quality_score as number | undefined;

        try {
          // Verify: assignment must have been assigned by this executive
          const [assignment] = await systemQuery(
            'SELECT id, assigned_to, assigned_by, task_description, parent_assignment_id, directive_id FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          if (!assignment) {
            return { success: false, error: 'Assignment not found' };
          }
          if (assignment.assigned_by !== ctx.agentRole) {
            return { success: false, error: 'You can only review assignments you created' };
          }

          const now = new Date().toISOString();
          const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';

          if (action === 'accept') {
            await systemQuery(
              'UPDATE work_assignments SET evaluation = $1, quality_score = $2, status = $3, updated_at = $4 WHERE id = $5',
              [evaluation, qualityScore ?? 8, 'completed', now, assignmentId],
            );

            // Log acceptance
            await systemQuery(
              'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)',
              [ctx.agentRole, ctx.agentRole, 'team.output_accepted', `Accepted: ${title} (score: ${qualityScore ?? 8})`, now],
            );

            // Check if all sibling tasks under the same parent are done
            if (assignment.parent_assignment_id) {
              const [remaining] = await systemQuery<{ count: number }>(
                "SELECT COUNT(*)::int as count FROM work_assignments WHERE parent_assignment_id = $1 AND status NOT IN ('completed')",
                [assignment.parent_assignment_id],
              );
              if (remaining && remaining.count === 0) {
                // All sub-tasks complete — notify the executive to consolidate
                await systemQuery(
                  'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
                  [
                    'system', ctx.agentRole,
                    `All team tasks for parent assignment ${assignment.parent_assignment_id} are now complete. Ready for consolidation.`,
                    'notification', 'normal', 'pending',
                  ],
                );
              }
            }
          } else if (action === 'revise') {
            await systemQuery(
              'UPDATE work_assignments SET evaluation = $1, status = $2, updated_at = $3 WHERE id = $4',
              [evaluation, 'needs_revision', now, assignmentId],
            );

            // Notify the team member
            await systemQuery(
              'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
              [
                ctx.agentRole, assignment.assigned_to as string,
                `**Revision Requested:** ${title}\n\n**Feedback:**\n${evaluation}`,
                'task', 'normal', 'pending',
              ],
            );

            // Emit revised event to wake the team member
            await glyphorEventBus.emit({
              type: 'assignment.revised',
              source: ctx.agentRole,
              payload: {
                assignment_id: assignmentId,
                target_agent: assignment.assigned_to,
              },
              priority: 'normal',
            });
          } else if (action === 'reassign') {
            const reassignTo = params.reassign_to as string;
            if (!reassignTo) {
              return { success: false, error: 'reassign_to is required for reassign action' };
            }

            const directReports = await getDirectReports(ctx.agentRole);
            if (!directReports.includes(reassignTo)) {
              return { success: false, error: `${reassignTo} does not report to you` };
            }

            await systemQuery(
              'UPDATE work_assignments SET assigned_to = $1, evaluation = $2, status = $3, updated_at = $4 WHERE id = $5',
              [reassignTo, evaluation, 'pending', now, assignmentId],
            );

            await systemQuery(
              'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
              [
                ctx.agentRole, reassignTo,
                `**Reassigned Task:** ${title}\n\n**Context:**\n${evaluation}`,
                'task', 'normal', 'pending',
              ],
            );
          }

          return {
            success: true,
            data: { assignment_id: assignmentId, action, status: action === 'accept' ? 'completed' : action === 'revise' ? 'needs_revision' : 'reassigned' },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── check_team_status ────────────────── */
    {
      name: 'check_team_status',
      description:
        'Check the status of all tasks you have assigned to your direct reports. ' +
        'Filter by agent or status. Shows capacity and blockers.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Filter by specific direct report (optional)',
          required: false,
        },
        status: {
          type: 'string',
          description: 'Filter by status (optional)',
          required: false,
          enum: ['pending', 'in_progress', 'completed', 'blocked', 'needs_revision'],
        },
        parent_assignment_id: {
          type: 'string',
          description: 'Filter tasks under a specific parent assignment (optional)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const conditions = ['assigned_by = $1'];
          const queryParams: unknown[] = [ctx.agentRole];
          let paramIndex = 2;

          if (params.agent_role) {
            conditions.push(`assigned_to = $${paramIndex++}`);
            queryParams.push(params.agent_role as string);
          }
          if (params.status) {
            conditions.push(`status = $${paramIndex++}`);
            queryParams.push(params.status as string);
          }
          if (params.parent_assignment_id) {
            conditions.push(`parent_assignment_id = $${paramIndex++}`);
            queryParams.push(params.parent_assignment_id as string);
          }

          const assignments = await systemQuery<{
            id: string; assigned_to: string; status: string; task_description: string;
            priority: string; agent_output: string; blocker_reason: string;
            parent_assignment_id: string; quality_score: number; created_at: string;
          }>(
            `SELECT id, assigned_to, status, task_description, priority, agent_output,
                    blocker_reason, parent_assignment_id, quality_score, created_at
             FROM work_assignments WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC LIMIT 50`,
            queryParams,
          );

          const byStatus = {
            pending: 0, in_progress: 0, completed: 0, blocked: 0, needs_revision: 0,
          };
          for (const a of assignments) {
            if (a.status in byStatus) byStatus[a.status as keyof typeof byStatus]++;
          }

          // Get direct reports list for context
          const directReports = await getDirectReports(ctx.agentRole);

          return {
            success: true,
            data: {
              direct_reports: directReports,
              total: assignments.length,
              byStatus,
              assignments: assignments.map(a => ({
                id: a.id,
                assigned_to: a.assigned_to,
                status: a.status,
                title: (a.task_description ?? '').slice(0, 100),
                priority: a.priority,
                has_output: !!a.agent_output,
                blocker: a.blocker_reason ?? null,
                quality_score: a.quality_score,
                parent_assignment_id: a.parent_assignment_id,
                created_at: a.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── escalate_to_sarah ────────────────── */
    {
      name: 'escalate_to_sarah',
      description:
        'Escalate an issue to Sarah (Chief of Staff) that requires cross-functional coordination, ' +
        'founder input, or is beyond your team\'s scope. Use sparingly — try peer coordination first.',
      parameters: {
        subject: {
          type: 'string',
          description: 'Brief subject line for the escalation',
          required: true,
        },
        context: {
          type: 'string',
          description: 'Full context: what happened, what you tried, what you need',
          required: true,
        },
        assignment_id: {
          type: 'string',
          description: 'Related assignment ID (optional)',
          required: false,
        },
        urgency: {
          type: 'string',
          description: 'How urgent is this',
          required: false,
          enum: ['low', 'normal', 'high', 'critical'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const urgency = (params.urgency as string) ?? 'normal';

        try {
          await systemQuery(
            `INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status, context)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              ctx.agentRole, 'chief-of-staff',
              `**Escalation from ${ctx.agentRole}:** ${params.subject}\n\n${params.context}`,
              'alert', urgency === 'critical' ? 'urgent' : 'normal', 'pending',
              JSON.stringify({ assignment_id: params.assignment_id ?? null, escalation: true }),
            ],
          );

          // Emit event to wake Sarah
          await glyphorEventBus.emit({
            type: 'escalation.created',
            source: ctx.agentRole,
            payload: {
              subject: params.subject,
              urgency,
              assignment_id: params.assignment_id ?? null,
              assigned_by: 'chief-of-staff',
            },
            priority: urgency === 'critical' ? 'high' : 'normal',
          });

          return {
            success: true,
            data: { escalated_to: 'chief-of-staff', urgency },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
