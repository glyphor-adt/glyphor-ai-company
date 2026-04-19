/**
 * Shared Assignment Tools — Work Assignment Lifecycle
 *
 * Tools:
 *   read_my_assignments       — Read pending work assignments from Sarah
 *   submit_assignment_output  — Submit completed work for evaluation
 *   flag_assignment_blocker   — Flag an assignment as blocked
 *
 * These close the orchestration loop: Sarah dispatches → agent works →
 * agent reports back → Sarah evaluates.
 */

import {
  ContractRequiredError,
  completeContractForTask,
  markContractInProgressForTask,
  requireContractForTask,
  type ToolDefinition,
  type ToolResult,
} from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/* ── Dependency Resolution ────────────────── */

/**
 * When an assignment completes, check if any dependent assignments now have
 * ALL dependencies met. If so, dispatch them immediately via the scheduler.
 * Fire-and-forget — errors are logged but don't block the submitting agent.
 */
async function dispatchDependentAssignments(
  completedAssignmentId: string,
): Promise<void> {
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://localhost:8080';

  // Find assignments that depend on the completed one
  const dependents = await systemQuery(
    'SELECT id, assigned_to, task_description, depends_on FROM work_assignments WHERE depends_on @> $1::jsonb AND status = ANY($2)',
    [JSON.stringify([completedAssignmentId]), ['pending', 'dispatched']],
  );

  if (!dependents?.length) return;

  for (const dep of dependents) {
    const allDeps: string[] = (dep.depends_on as string[]) ?? [];

    // Check if ALL dependencies are now completed
    const completed = await systemQuery(
      'SELECT id FROM work_assignments WHERE id = ANY($1) AND status = $2',
      [allDeps, 'completed'],
    );

    if (completed?.length !== allDeps.length) continue;

    // All dependencies met — dispatch immediately
    console.log(
      `[DependencyResolution] All deps met for ${dep.assigned_to} ` +
      `(${dep.id}) — dispatching immediately`,
    );

    // Fire-and-forget: same pattern as dispatch_assignment in chief-of-staff tools
    fetch(`${schedulerUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentRole: dep.assigned_to,
        task: 'work_loop',
        message: dep.task_description,
        payload: {
          directiveAssignmentId: dep.id,
          wake_reason: 'dependency_resolved',
        },
      }),
    }).catch(err => {
      console.warn(`[DependencyResolution] Dispatch failed for ${dep.assigned_to}:`, err);
    });
  }
}

/* ── Factory ──────────────────────────────── */

export function createAssignmentTools(
  glyphorEventBus: GlyphorEventBus,
): ToolDefinition[] {
  return [
    /* ── read_my_assignments ─────────────── */
    {
      name: 'read_my_assignments',
      description:
        'Read your pending work assignments from Sarah (Chief of Staff). Call this when you have unread assignment messages, at the start of scheduled runs to check for waiting work, or to re-read assignment instructions and any feedback from previous submissions.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by assignment status. Omit to see all non-completed assignments.',
          required: false,
          enum: ['pending', 'dispatched', 'in_progress', 'completed', 'needs_revision', 'blocked'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const statusFilter = params.status as string | undefined;

        let whereClause = 'wa.assigned_to = $1';
        const queryParams: unknown[] = [ctx.agentRole];
        if (statusFilter) {
          queryParams.push(statusFilter);
          whereClause += ` AND wa.status = $${queryParams.length}`;
        } else {
          queryParams.push(['pending', 'dispatched', 'in_progress', 'needs_revision']);
          whereClause += ` AND wa.status = ANY($${queryParams.length})`;
        }

        try {
          const data = await systemQuery(
            `SELECT wa.id, wa.task_description, wa.task_type, wa.expected_output, wa.status,
                    wa.priority, wa.sequence_order, wa.agent_output, wa.evaluation, wa.quality_score,
                    wa.dispatched_at, wa.completed_at, wa.created_at, wa.updated_at,
                    fd.id as directive_id, fd.title as directive_title, fd.description as directive_description,
                    fd.priority as directive_priority, fd.category as directive_category,
                    fd.status as directive_status, fd.due_date as directive_due_date
             FROM work_assignments wa
             LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
             WHERE ${whereClause}
             ORDER BY wa.priority ASC, wa.created_at ASC`,
            queryParams,
          );

          const assignments = (data ?? []).map((a: Record<string, unknown>) => ({
            id: a.id,
            title: (a.task_description as string)?.slice(0, 100),
            instructions: a.task_description,
            expected_output: a.expected_output,
            status: a.status,
            priority: a.priority,
            directive_title: a.directive_title ?? null,
            directive_priority: a.directive_priority ?? null,
            directive_description: a.directive_description ?? null,
            directive_due_date: a.directive_due_date ?? null,
            feedback: a.status === 'needs_revision' ? a.evaluation : null,
            quality_score: a.quality_score,
            assigned_at: a.dispatched_at ?? a.created_at,
          }));

          return {
            success: true,
            data: {
              count: assignments.length,
              assignments,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── submit_assignment_output ─────────── */
    {
      name: 'submit_assignment_output',
      description:
        'Submit your completed work for a specific assignment that is assigned to you. Include your full deliverable. Sarah will evaluate the quality and either accept it or send it back with feedback. Use status "completed" for final submissions, "in_progress" for partial updates with progress notes. If an assignment is owned by another agent, use send_agent_message to follow up instead of submitting on their behalf.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'The assignment UUID',
          required: true,
        },
        output: {
          type: 'string',
          description: 'Your deliverable — findings, analysis, recommendations, etc.',
          required: true,
        },
        status: {
          type: 'string',
          description: 'Submission status (default: completed)',
          required: false,
          enum: ['completed', 'in_progress'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const assignmentId = params.assignment_id as string;
        const output = params.output as string;
        const status = (params.status as string) ?? 'completed';

        try {
          // Verify the assignment belongs to this agent
          const [assignment] = await systemQuery(
            'SELECT id, assigned_to, assigned_by, task_description, directive_id FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          if (!assignment) {
            return { success: false, error: 'Assignment not found' };
          }
          if (assignment.assigned_to !== ctx.agentRole) {
            const owner = assignment.assigned_to as string;
            return {
              success: false,
              error:
                `Assignment ${assignmentId} is assigned to ${owner}, not ${ctx.agentRole}. ` +
                `Only the assignee can call submit_assignment_output. ` +
                `Use send_agent_message to ${owner} for status updates or unblock support.`,
            };
          }

          // Route notification to whoever assigned this work (default: chief-of-staff)
          const notifyAgent = (assignment.assigned_by as string) || 'chief-of-staff';
          await requireContractForTask(assignmentId, ctx.agentRole);

          // Build update
          const now = new Date().toISOString();

          // Check if this is the first work — set dispatched_at if not already set
          const [current] = await systemQuery(
            'SELECT dispatched_at FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          if (status === 'completed') {
            // ─── EVIDENCE GATE: reject trivially short completions ──────────────
            // Prevents agents from submitting a one-liner and claiming full completion.
            // Threshold matches taskOutcomeHarvester MIN_MEANINGFUL_OUTPUT_LENGTH (100)
            // so the gate and the harvester are aligned: nothing under 100 chars can
            // claim completed at the tool level OR survive harvest without downgrade.
            const trimmedOutput = output?.trim() ?? '';
            if (trimmedOutput.length < 100) {
              return {
                success: false,
                error:
                  `Output is too short (${trimmedOutput.length} chars) to mark as completed. ` +
                  `Provide a substantive summary of what was accomplished (minimum 100 characters). ` +
                  `For partial progress, use status='in_progress' instead.`,
              };
            }

            // Confidence score reflects output length as a proxy for evidence quality.
            // Scale must stay ≥ DEFAULT_HANDOFF_CONFIDENCE_THRESHOLD (0.7) for any output
            // that passes the gate, otherwise the contract escalates instead of completing.
            const confidenceScore =
              trimmedOutput.length >= 500 ? 1.0
              : trimmedOutput.length >= 300 ? 0.9
              : 0.75; // 100–299 chars: passes gate, just above 0.7 threshold

            await completeContractForTask(
              assignmentId,
              ctx.agentRole,
              {
                output,
                assignmentId,
                submittedBy: ctx.agentRole,
                status,
              },
              confidenceScore,
            );
            if (current && !current.dispatched_at) {
              await systemQuery(
                'UPDATE work_assignments SET agent_output = $1, status = $2, updated_at = $3, completed_at = $3, dispatched_at = $3 WHERE id = $4',
                [output, status, now, assignmentId],
              );
            } else {
              await systemQuery(
                'UPDATE work_assignments SET agent_output = $1, status = $2, updated_at = $3, completed_at = $3 WHERE id = $4',
                [output, status, now, assignmentId],
              );
            }
          } else {
            await markContractInProgressForTask(assignmentId, ctx.agentRole);
            if (current && !current.dispatched_at) {
              await systemQuery(
                'UPDATE work_assignments SET agent_output = $1, status = $2, updated_at = $3, dispatched_at = $3 WHERE id = $4',
                [output, status, now, assignmentId],
              );
            } else {
              await systemQuery(
                'UPDATE work_assignments SET agent_output = $1, status = $2, updated_at = $3 WHERE id = $4',
                [output, status, now, assignmentId],
              );
            }
          }

          // Notify the assigner (executive or Sarah)
          const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';
          const msgContent = status === 'completed'
            ? `Assignment '${title}' completed. Output submitted for review.`
            : `Assignment '${title}' progress update submitted.`;

          await systemQuery(
            `INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [ctx.agentRole, notifyAgent, crypto.randomUUID(), msgContent, 'response', 'normal', 'pending',
             JSON.stringify({ assignment_id: assignmentId, directive_id: assignment.directive_id })],
          );

          // Emit event (include assigned_by for wake rule routing)
          await glyphorEventBus.emit({
            type: 'assignment.submitted',
            source: ctx.agentRole,
            payload: {
              assignment_id: assignmentId,
              directive_id: assignment.directive_id,
              assigned_by: notifyAgent,
              status,
            },
            priority: 'normal',
          });

          // Event-driven dependency resolution: dispatch agents whose deps are now met
          if (status === 'completed') {
            dispatchDependentAssignments(assignmentId).catch(err => {
              console.warn('[DependencyResolution] Failed:', (err as Error).message);
            });
          }

          // Log to activity_log
          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
            [ctx.agentRole, status === 'completed' ? 'assignment.completed' : 'assignment.progress',
             `${status === 'completed' ? 'Completed' : 'Updated'} assignment: ${title}`],
          );

          return {
            success: true,
            data: {
              assignment_id: assignmentId,
              status,
              message: `Output submitted. ${notifyAgent === 'chief-of-staff' ? 'Sarah' : notifyAgent} will evaluate.`,
              written: { assignment_id: assignmentId, status, action: 'submit_output' },
            },
          };
        } catch (err) {
          if (err instanceof ContractRequiredError) {
            throw err;
          }
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── flag_assignment_blocker ──────────── */
    {
      name: 'flag_assignment_blocker',
      description:
        'Flag YOUR OWN work assignment as blocked. Only the assignee can flag their own assignment. ' +
        'If you cannot act on a teammate\'s blocker, use send_agent_message to them, or escalate_to_sarah ' +
        'if cross-functional coordination is needed. ' +
        'Returns success: true even when the flag cannot be applied — check the `flagged` field and ' +
        'the `next_action` field for what to do instead.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'The assignment UUID — must be one assigned TO YOU. Use read_my_assignments to get yours.',
          required: true,
        },
        blocker_reason: {
          type: 'string',
          description: 'What is blocking you and what you need to proceed',
          required: true,
        },
        need_type: {
          type: 'string',
          description: 'Category of what you need',
          required: false,
          enum: ['tool_access', 'data_access', 'peer_help', 'founder_input', 'external_dependency', 'unclear_instructions', 'other'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const assignmentId = params.assignment_id as string;
        const blockerReason = params.blocker_reason as string;
        const needType = (params.need_type as string) ?? 'other';

        if (!assignmentId?.trim() || !blockerReason?.trim()) {
          return {
            success: false,
            error: 'assignment_id and blocker_reason are required.',
          };
        }

        try {
          // Step 1: look up the assignment
          const [assignment] = await systemQuery(
            'SELECT id, assigned_to, assigned_by, task_description, directive_id, status FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          // Case A: assignment doesn't exist as an assignment.
          // Check if the caller confused assignment_id with directive_id.
          if (!assignment) {
            const [asDirective] = await systemQuery(
              'SELECT id, title FROM founder_directives WHERE id = $1',
              [assignmentId],
            );

            if (asDirective) {
              // They passed a directive_id, not an assignment_id
              const myAssignments = await systemQuery(
                `SELECT id, task_description FROM work_assignments
                 WHERE directive_id = $1 AND assigned_to = $2
                 AND status IN ('pending', 'dispatched', 'in_progress', 'needs_revision')`,
                [assignmentId, ctx.agentRole],
              );

              return {
                success: true,
                data: {
                  flagged: false,
                  reason: 'wrong_id_type',
                  message: `You passed a directive_id instead of an assignment_id. Directive "${asDirective.title}" has ${myAssignments.length} open assignment(s) for you.`,
                  next_action: myAssignments.length > 0
                    ? `Retry with one of these assignment IDs: ${myAssignments.map((a: Record<string, unknown>) => a.id).join(', ')}`
                    : 'You do not have any open assignments under this directive. Use read_my_assignments to see yours.',
                  your_open_assignments_for_this_directive: myAssignments.map((a: Record<string, unknown>) => ({
                    assignment_id: a.id,
                    title: (a.task_description as string)?.slice(0, 100),
                  })),
                },
              };
            }

            // Genuine not found: stale ID or fabrication
            return {
              success: true,
              data: {
                flagged: false,
                reason: 'assignment_not_found',
                message: `No assignment found with ID "${assignmentId}". This may be stale, completed, or never existed.`,
                next_action: 'Call read_my_assignments to see your current open assignments.',
              },
            };
          }

          // Case B: ownership mismatch — route to the right mechanism
          if (assignment.assigned_to !== ctx.agentRole) {
            const owner = assignment.assigned_to as string;
            const isAlreadyBlocked = assignment.status === 'blocked';
            const isComplete = assignment.status === 'completed';

            return {
              success: true,
              data: {
                flagged: false,
                reason: 'not_your_assignment',
                assignment_owner: owner,
                assignment_status: assignment.status,
                message: isComplete
                  ? `Assignment is already completed by ${owner}. Nothing to flag.`
                  : isAlreadyBlocked
                    ? `Assignment is already flagged as blocked by ${owner}. No action needed.`
                    : `Assignment is owned by ${owner}, not you.`,
                next_action: isComplete || isAlreadyBlocked
                  ? 'No action needed.'
                  : `Use send_agent_message to coordinate with ${owner} directly, or escalate_to_sarah if cross-functional unblock is needed. Do not flag assignments that are not yours.`,
              },
            };
          }

          // Case C: already flagged as blocked — idempotent no-op
          if (assignment.status === 'blocked') {
            return {
              success: true,
              data: {
                flagged: false,
                reason: 'already_blocked',
                message: `Assignment is already flagged as blocked. No duplicate flag written.`,
                next_action: 'Wait for triage, or use send_agent_message to Sarah for urgent follow-up.',
              },
            };
          }

          // Case D: already completed — nothing to block
          if (assignment.status === 'completed') {
            return {
              success: true,
              data: {
                flagged: false,
                reason: 'already_completed',
                message: `Assignment is already completed. Cannot flag a completed assignment as blocked.`,
                next_action: 'If the completion was wrong, use send_agent_message to Sarah to reopen it.',
              },
            };
          }

          // Case E: the actual work — flag the blocker
          const notifyAgent = (assignment.assigned_by as string) || 'chief-of-staff';
          const now = new Date().toISOString();
          const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';

          await systemQuery(
            'UPDATE work_assignments SET status = $1, blocker_reason = $2, need_type = $3, updated_at = $4 WHERE id = $5',
            ['blocked', blockerReason, needType, now, assignmentId],
          );

          await systemQuery(
            `INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              ctx.agentRole, notifyAgent, crypto.randomUUID(),
              `BLOCKED: Assignment '${title}'\nReason: ${blockerReason}\nNeed: ${needType}`,
              'alert', 'urgent', 'pending',
              JSON.stringify({
                assignment_id: assignmentId,
                directive_id: assignment.directive_id,
                need_type: needType,
              }),
            ],
          );

          await glyphorEventBus.emit({
            type: 'assignment.blocked',
            source: ctx.agentRole,
            payload: {
              title: `Assignment blocked: ${title}`,
              description: blockerReason,
              assignment_id: assignmentId,
              directive_id: assignment.directive_id,
              assigned_by: notifyAgent,
              need_type: needType,
            },
            priority: 'high',
          });

          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
            [ctx.agentRole, 'assignment.blocked', `Blocked on assignment: ${title} — ${blockerReason}`],
          );

          return {
            success: true,
            data: {
              flagged: true,
              assignment_id: assignmentId,
              status: 'blocked',
              message: `Blocker flagged. ${notifyAgent === 'chief-of-staff' ? 'Sarah' : notifyAgent} will triage.`,
              next_action: `Wait for triage. If urgent, send_agent_message to ${notifyAgent}.`,
              written: { assignment_id: assignmentId, status: 'blocked', action: 'flag_blocker' },
            },
          };
        } catch (err) {
          // Genuine error path — this is a REAL failure
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
