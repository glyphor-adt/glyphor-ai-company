/**
 * Executive Orchestration Tools — Directive Decomposition & Evaluation
 *
 * Tools for executive agents (CTO, CPO, CMO, etc.) to decompose directives
 * delegated by Sarah into scoped work assignments, evaluate submitted outputs,
 * monitor team progress, and synthesize deliverables.
 *
 * Tools:
 *   create_team_assignments     — Decompose a directive into assignments for allowed assignees
 *   evaluate_team_output        — Accept or revise submitted assignment work
 *   check_team_status           — Query assignment status for this executive's work
 *   synthesize_team_deliverable — Collect completed outputs and submit to Sarah
 *
 * CRITICAL: Every tool enforces scope — executives can ONLY operate on agents
 * in allowed_assignees and directives delegated to them.
 */

import type { ToolDefinition, ToolResult, CompanyAgentRole } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { markOutcomeAccepted, markOutcomeRevised } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/* ── Config Interface ────────────────────── */

export interface ExecutiveOrchestrationConfig {
  executive_role: string;
  can_decompose: boolean;
  can_evaluate: boolean;
  can_create_sub_directives: boolean;
  allowed_assignees: string[];
  max_assignments_per_directive: number;
  requires_plan_verification: boolean;
  is_canary: boolean;
}

/* ── Dependency Resolution ────────────────── */

/**
 * When an assignment completes, check if any dependent assignments now have
 * ALL dependencies met. If so, dispatch them immediately via the scheduler.
 */
async function dispatchDependentAssignments(
  completedAssignmentId: string,
): Promise<void> {
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://localhost:8080';

  const dependents = await systemQuery(
    'SELECT id, assigned_to, task_description, depends_on FROM work_assignments WHERE depends_on @> $1::jsonb AND status = ANY($2)',
    [JSON.stringify([completedAssignmentId]), ['pending', 'dispatched']],
  );

  if (!dependents?.length) return;

  for (const dep of dependents) {
    const allDeps: string[] = (dep.depends_on as string[]) ?? [];

    const completed = await systemQuery(
      'SELECT id FROM work_assignments WHERE id = ANY($1) AND status = $2',
      [allDeps, 'completed'],
    );

    if (completed?.length !== allDeps.length) continue;

    console.log(
      `[ExecOrchestration] All deps met for ${dep.assigned_to} ` +
      `(${dep.id}) — dispatching immediately`,
    );

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
      console.warn(`[ExecOrchestration] Dispatch failed for ${dep.assigned_to}:`, err);
    });
  }
}

/* ── Factory ──────────────────────────────── */

export function createExecutiveOrchestrationTools(
  agentRole: CompanyAgentRole,
  orchestrationConfig: ExecutiveOrchestrationConfig,
  deps: { glyphorEventBus?: GlyphorEventBus },
): ToolDefinition[] {
  const { glyphorEventBus } = deps;

  return [
    /* ── create_team_assignments ────────── */
    {
      name: 'create_team_assignments',
      description:
        'Decompose a delegated directive into work assignments for your team. ' +
        'Each assignment is scoped to agents in your allowed_assignees list. ' +
        `Your allowed assignees: ${orchestrationConfig.allowed_assignees.join(', ')}.`,
      parameters: {
        directive_id: {
          type: 'string',
          description: 'UUID of the founder directive delegated to you',
          required: true,
        },
        assignments: {
          type: 'array',
          description: 'Array of work assignments to create',
          required: true,
          items: {
            type: 'object',
            description: 'A work assignment for a team member',
            properties: {
              assigned_to: {
                type: 'string',
                description: `Agent role to assign to. Must be one of: ${orchestrationConfig.allowed_assignees.join(', ')}`,
              },
              task_description: {
                type: 'string',
                description: 'Clear description of what they need to do',
              },
              expected_output: {
                type: 'string',
                description: 'What you expect them to deliver',
              },
              depends_on: {
                type: 'array',
                description: 'IDs of assignments this depends on (optional)',
                items: { type: 'string', description: 'Assignment ID' },
              },
              sequence_order: {
                type: 'number',
                description: 'Execution order. 0 = immediate.',
              },
            },
          },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!orchestrationConfig.can_decompose) {
          return { success: false, error: 'Decomposition is not enabled for your role' };
        }

        const directiveId = params.directive_id as string;
        const assignments = params.assignments as Array<{
          assigned_to: string;
          task_description: string;
          expected_output: string;
          depends_on?: string[];
          sequence_order?: number;
        }>;

        if (!assignments?.length) {
          return { success: false, error: 'At least one assignment is required' };
        }

        // Validate assignment count
        if (assignments.length > orchestrationConfig.max_assignments_per_directive) {
          return {
            success: false,
            error: `Too many assignments: ${assignments.length} exceeds limit of ${orchestrationConfig.max_assignments_per_directive}`,
          };
        }

        // Validate all assignees are allowed
        const disallowed = assignments
          .map(a => a.assigned_to)
          .filter(role => !orchestrationConfig.allowed_assignees.includes(role));
        if (disallowed.length > 0) {
          return {
            success: false,
            error: `Cannot assign to: ${Array.from(new Set(disallowed)).join(', ')}. ` +
              `Allowed assignees: ${orchestrationConfig.allowed_assignees.join(', ')}`,
          };
        }

        try {
          // Verify directive is delegated to this executive
          const [directive] = await systemQuery(
            'SELECT id, title, description, priority, delegated_to FROM founder_directives WHERE id = $1',
            [directiveId],
          );

          if (!directive) {
            return { success: false, error: 'Directive not found' };
          }
          if (directive.delegated_to !== agentRole) {
            return {
              success: false,
              error: `Directive is not delegated to you (delegated_to: ${directive.delegated_to ?? 'none'})`,
            };
          }

          // Insert assignments as 'draft'; plan verification promotes to 'pending'
          const rows = assignments.map((a, i) => ({
            directive_id: directiveId,
            assigned_to: a.assigned_to,
            assigned_by: agentRole,
            created_by: agentRole,
            task_description: a.task_description,
            task_type: 'team_task',
            expected_output: a.expected_output,
            depends_on: a.depends_on ? JSON.stringify(a.depends_on) : null,
            priority: 'normal',
            sequence_order: a.sequence_order ?? i,
            assignment_type: 'team_task',
            status: 'draft',
          }));

          const columns = '(directive_id, assigned_to, assigned_by, created_by, task_description, task_type, expected_output, depends_on, priority, sequence_order, assignment_type, status)';
          const values: unknown[] = [];
          const placeholders: string[] = [];
          for (const a of rows) {
            const offset = values.length;
            placeholders.push(
              `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}::jsonb, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`,
            );
            values.push(
              a.directive_id, a.assigned_to, a.assigned_by, a.created_by,
              a.task_description, a.task_type, a.expected_output, a.depends_on,
              a.priority, a.sequence_order, a.assignment_type, a.status,
            );
          }

          const data = await systemQuery(
            `INSERT INTO work_assignments ${columns} VALUES ${placeholders.join(', ')} RETURNING id`,
            values,
          );
          const createdIds = (data as any[]).map((r: any) => r.id);

          // ── Plan Verification ──
          let verification: { verdict: string; suggestions: string[] } | null = null;

          if (orchestrationConfig.requires_plan_verification) {
            try {
              const modName = '@glyphor/scheduler';
              const scheduler = await (Function('m', 'return import(m)')(modName)) as any;

              if (typeof scheduler.verifyPlan === 'function') {
                const result = await scheduler.verifyPlan({
                  directive: {
                    id: directive.id as string,
                    title: directive.title as string,
                    description: (directive.description as string) ?? '',
                    priority: (directive.priority as string) ?? 'normal',
                  },
                  proposed_assignments: assignments.map((a, i) => ({
                    assigned_to: a.assigned_to,
                    task_description: a.task_description,
                    expected_output: a.expected_output || '',
                    depends_on: a.depends_on,
                    sequence_order: a.sequence_order ?? i,
                  })),
                });
                verification = result;

                if (result.verdict === 'REVISE') {
                  const feedback = result.suggestions?.join('; ') || 'Plan needs revision';
                  await systemQuery(
                    'INSERT INTO activity_log (agent_role, activity_type, description) VALUES ($1, $2, $3)',
                    [agentRole, 'plan_verification', `REVISE: ${feedback}`],
                  );

                  return {
                    success: true,
                    data: {
                      created: createdIds.length,
                      status: 'draft',
                      verification: { verdict: 'REVISE', suggestions: result.suggestions },
                      message: 'Plan verification requested revision. Assignments remain in draft. Revise your decomposition based on the feedback.',
                    },
                  };
                }

                // APPROVE or WARN → promote to 'pending'
                await systemQuery(
                  "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
                  [createdIds],
                );
                if (result.verdict === 'WARN' && result.suggestions?.length) {
                  await systemQuery(
                    'INSERT INTO activity_log (agent_role, activity_type, description) VALUES ($1, $2, $3)',
                    [agentRole, 'plan_verification', `WARN: ${result.suggestions.join('; ')}`],
                  );
                }
              } else {
                await systemQuery(
                  "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
                  [createdIds],
                );
              }
            } catch (verifyErr) {
              console.warn(`[ExecOrchestration] Plan verification skipped:`, (verifyErr as Error).message);
              await systemQuery(
                "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
                [createdIds],
              );
            }
          } else {
            // No verification required — promote directly
            await systemQuery(
              "UPDATE work_assignments SET status = 'pending' WHERE id = ANY($1)",
              [createdIds],
            );
          }

          // Emit events for each assignment
          if (glyphorEventBus) {
            for (let i = 0; i < createdIds.length; i++) {
              const id = createdIds[i];
              await glyphorEventBus.emit({
                type: 'assignment.created',
                source: agentRole,
                payload: {
                  assignment_id: id,
                  assigned_to: assignments[i].assigned_to,
                  assigned_by: agentRole,
                  directive_id: directiveId,
                },
                priority: 'normal',
              });
            }
          }

          // Log activity
          const now = new Date().toISOString();
          await systemQuery(
            'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
            [agentRole, agentRole, 'executive.assignments_created',
             `Created ${createdIds.length} assignments for directive ${directiveId}`, now],
          );

          const finalData = await systemQuery(
            'SELECT * FROM work_assignments WHERE id = ANY($1)', [createdIds],
          );

          return {
            success: true,
            data: {
              created: (finalData as any[]).length,
              assignments: finalData,
              ...(verification ? { verification: { verdict: verification.verdict, suggestions: verification.suggestions } } : {}),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── evaluate_team_output ─────────────── */
    {
      name: 'evaluate_team_output',
      description:
        'Evaluate submitted work from a team member. Accept the output (marks completed) ' +
        'or request revisions with feedback. Only works on assignments you created.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'UUID of the assignment to evaluate',
          required: true,
        },
        verdict: {
          type: 'string',
          description: 'Accept the work or send it back for revision',
          required: true,
          enum: ['accept', 'revise'],
        },
        feedback: {
          type: 'string',
          description: 'Your evaluation comments or revision feedback',
          required: true,
        },
        quality_score: {
          type: 'number',
          description: 'Quality score 1-5',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        if (!orchestrationConfig.can_evaluate) {
          return { success: false, error: 'Evaluation is not enabled for your role' };
        }

        const assignmentId = params.assignment_id as string;
        const verdict = params.verdict as 'accept' | 'revise';
        const feedback = params.feedback as string;
        const qualityScore = Math.max(1, Math.min(5, params.quality_score as number));

        try {
          // Verify assignment exists and was created by this executive
          const [assignment] = await systemQuery(
            'SELECT id, assigned_to, created_by, task_description, directive_id, status FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          if (!assignment) {
            return { success: false, error: 'Assignment not found' };
          }
          if (assignment.created_by !== agentRole) {
            return { success: false, error: 'You can only evaluate assignments you created' };
          }
          if (assignment.status !== 'completed' && assignment.status !== 'submitted') {
            return {
              success: false,
              error: `Assignment status is '${assignment.status}' — expected 'completed' or 'submitted'`,
            };
          }

          const now = new Date().toISOString();
          const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';

          if (verdict === 'accept') {
            await systemQuery(
              'UPDATE work_assignments SET evaluation = $1, quality_score = $2, status = $3, completed_at = $4, updated_at = $4 WHERE id = $5',
              [feedback, qualityScore, 'completed', now, assignmentId],
            );

            // Trigger dependency resolution
            dispatchDependentAssignments(assignmentId).catch(err => {
              console.warn('[ExecOrchestration] Dependency dispatch failed:', (err as Error).message);
            });

            // Signal Learning Governor
            try {
              await markOutcomeAccepted(assignmentId);
            } catch (err) {
              console.warn(`[ExecOrchestration] Outcome signal failed for ${assignmentId}:`, (err as Error).message);
            }

            await systemQuery(
              'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)',
              [agentRole, agentRole, 'executive.output_accepted',
               `Accepted: ${title} (score: ${qualityScore}/5)`, now],
            );
          } else {
            // Revise
            await systemQuery(
              'UPDATE work_assignments SET evaluation = $1, quality_score = $2, status = $3, updated_at = $4 WHERE id = $5',
              [feedback, qualityScore, 'needs_revision', now, assignmentId],
            );

            // Signal Learning Governor
            try {
              await markOutcomeRevised(assignmentId);
            } catch (err) {
              console.warn(`[ExecOrchestration] Outcome signal failed for ${assignmentId}:`, (err as Error).message);
            }

            // Notify the assigned agent
            await systemQuery(
              'INSERT INTO agent_messages (from_agent, to_agent, message, message_type, priority, status) VALUES ($1,$2,$3,$4,$5,$6)',
              [
                agentRole, assignment.assigned_to as string,
                `**Revision Requested:** ${title}\n\n**Feedback:**\n${feedback}\n\n**Score:** ${qualityScore}/5`,
                'task', 'normal', 'pending',
              ],
            );

            // Emit revised event to wake the assigned agent
            if (glyphorEventBus) {
              await glyphorEventBus.emit({
                type: 'assignment.revised',
                source: agentRole,
                payload: {
                  assignment_id: assignmentId,
                  directive_id: assignment.directive_id,
                  target_agent: assignment.assigned_to,
                  feedback,
                },
                priority: 'high',
              });
            }

            await systemQuery(
              'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)',
              [agentRole, agentRole, 'executive.output_revised',
               `Revision requested: ${title} (score: ${qualityScore}/5)`, now],
            );
          }

          return {
            success: true,
            data: { assignment_id: assignmentId, verdict, feedback },
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
        'Check the status of all assignments you created. ' +
        'Optionally filter by directive. Shows per-assignment status and aggregate summary.',
      parameters: {
        directive_id: {
          type: 'string',
          description: 'Filter by directive UUID (optional)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const conditions = ['created_by = $1'];
          const queryParams: unknown[] = [agentRole];
          let paramIndex = 2;

          if (params.directive_id) {
            conditions.push(`directive_id = $${paramIndex++}`);
            queryParams.push(params.directive_id as string);
          }

          const assignments = await systemQuery<{
            id: string; assigned_to: string; status: string; task_description: string;
            priority: string; agent_output: string; blocker_reason: string;
            directive_id: string; quality_score: number; created_at: string;
            evaluation: string; sequence_order: number;
          }>(
            `SELECT id, assigned_to, status, task_description, priority, agent_output,
                    blocker_reason, directive_id, quality_score, created_at,
                    evaluation, sequence_order
             FROM work_assignments WHERE ${conditions.join(' AND ')}
             ORDER BY sequence_order ASC, created_at ASC LIMIT 100`,
            queryParams,
          );

          const byStatus: Record<string, number> = {
            draft: 0, pending: 0, dispatched: 0, in_progress: 0,
            completed: 0, blocked: 0, needs_revision: 0,
          };
          for (const a of assignments) {
            if (a.status in byStatus) byStatus[a.status]++;
            else byStatus[a.status] = 1;
          }

          return {
            success: true,
            data: {
              total: assignments.length,
              summary: byStatus,
              all_completed: assignments.length > 0 && assignments.every(a => a.status === 'completed'),
              assignments: assignments.map(a => ({
                id: a.id,
                assigned_to: a.assigned_to,
                status: a.status,
                title: (a.task_description ?? '').slice(0, 100),
                priority: a.priority,
                sequence_order: a.sequence_order,
                has_output: !!a.agent_output,
                output_preview: a.agent_output
                  ? (a.agent_output as string).length > 200
                    ? (a.agent_output as string).substring(0, 200) + '...'
                    : a.agent_output
                  : null,
                blocker: a.blocker_reason ?? null,
                quality_score: a.quality_score,
                evaluation: a.evaluation ?? null,
                directive_id: a.directive_id,
                created_at: a.created_at,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── synthesize_team_deliverable ──────── */
    {
      name: 'synthesize_team_deliverable',
      description:
        'Collect all completed assignment outputs for a directive and synthesize into a consolidated deliverable. ' +
        'Submits the result back to Sarah for evaluation. Use when all team assignments are complete.',
      parameters: {
        directive_id: {
          type: 'string',
          description: 'UUID of the directive to synthesize outputs for',
          required: true,
        },
        synthesis_notes: {
          type: 'string',
          description: 'Your synthesis: how the individual outputs combine into the directive deliverable',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const directiveId = params.directive_id as string;
        const synthesisNotes = params.synthesis_notes as string;

        try {
          // Verify directive is delegated to this executive
          const [directive] = await systemQuery(
            'SELECT id, title, delegated_to, status, initiative_id FROM founder_directives WHERE id = $1',
            [directiveId],
          );

          if (!directive) {
            return { success: false, error: 'Directive not found' };
          }
          if (directive.delegated_to !== agentRole) {
            return {
              success: false,
              error: `Directive is not delegated to you (delegated_to: ${directive.delegated_to ?? 'none'})`,
            };
          }

          // Collect completed assignments for this directive created by this executive
          const completedAssignments = await systemQuery<{
            id: string; assigned_to: string; task_description: string;
            agent_output: string; quality_score: number;
          }>(
            `SELECT id, assigned_to, task_description, agent_output, quality_score
             FROM work_assignments
             WHERE directive_id = $1 AND created_by = $2 AND status = 'completed'
             ORDER BY sequence_order ASC`,
            [directiveId, agentRole],
          );

          if (!completedAssignments?.length) {
            return {
              success: false,
              error: 'No completed assignments found for this directive. Ensure all team assignments are complete before synthesizing.',
            };
          }

          // Check for incomplete assignments
          const [incompleteCount] = await systemQuery<{ count: number }>(
            "SELECT COUNT(*)::int as count FROM work_assignments WHERE directive_id = $1 AND created_by = $2 AND status NOT IN ('completed')",
            [directiveId, agentRole],
          );

          const outputSummary = completedAssignments.map(a => ({
            assigned_to: a.assigned_to,
            task: (a.task_description as string)?.slice(0, 100),
            output: a.agent_output,
            quality_score: a.quality_score,
          }));

          // Find the executive's own assignment from Sarah (to submit output against)
          const [executiveAssignment] = await systemQuery(
            "SELECT id FROM work_assignments WHERE directive_id = $1 AND assigned_to = $2 AND assigned_by = 'chief-of-staff' LIMIT 1",
            [directiveId, agentRole],
          );

          const now = new Date().toISOString();
          const synthesizedOutput = JSON.stringify({
            synthesis: synthesisNotes,
            team_outputs: outputSummary,
            completed_count: completedAssignments.length,
            incomplete_count: incompleteCount?.count ?? 0,
          });
          const deliverableMetadata = {
            synthesized: true,
            source: 'executive_team_synthesis',
            completed_assignment_count: completedAssignments.length,
            incomplete_assignment_count: incompleteCount?.count ?? 0,
            team_outputs: outputSummary.map((item) => ({
              assigned_to: item.assigned_to,
              task: item.task,
              quality_score: item.quality_score,
            })),
          };

          // If there's an executive assignment from Sarah, submit output to it
          if (executiveAssignment) {
            await systemQuery(
              'UPDATE work_assignments SET agent_output = $1, status = $2, updated_at = $3, completed_at = $3 WHERE id = $4',
              [synthesizedOutput, 'completed', now, executiveAssignment.id],
            );
          }

          const deliverableAssignmentId = (executiveAssignment as { id?: string } | undefined)?.id ?? null;
          const [existingDeliverable] = await systemQuery<{ id: string }>(
            `SELECT id
             FROM deliverables
             WHERE directive_id = $1
               AND assignment_id IS NOT DISTINCT FROM $2
               AND producing_agent = $3
               AND status = 'published'
               AND COALESCE(metadata->>'source', '') = $4
             ORDER BY created_at DESC
             LIMIT 1`,
            [directiveId, deliverableAssignmentId, agentRole, 'executive_team_synthesis'],
          );

          let deliverableId: string;
          if (existingDeliverable) {
            const [updatedDeliverable] = await systemQuery<{ id: string }>(
              `UPDATE deliverables
               SET initiative_id = $1,
                   title = $2,
                   type = 'document',
                   content = $3,
                   storage_url = NULL,
                   status = 'published',
                   metadata = $4::jsonb
               WHERE id = $5
               RETURNING id`,
              [
                (directive as any).initiative_id ?? null,
                `Directive deliverable: ${directive.title as string}`,
                synthesizedOutput,
                JSON.stringify(deliverableMetadata),
                existingDeliverable.id,
              ],
            );
            deliverableId = updatedDeliverable.id;
          } else {
            const [createdDeliverable] = await systemQuery<{ id: string }>(
              `INSERT INTO deliverables
                 (initiative_id, directive_id, assignment_id, title, type, content, producing_agent, status, metadata)
               VALUES ($1, $2, $3, $4, 'document', $5, $6, 'published', $7::jsonb)
               RETURNING id`,
              [
                (directive as any).initiative_id ?? null,
                directiveId,
                deliverableAssignmentId,
                `Directive deliverable: ${directive.title as string}`,
                synthesizedOutput,
                agentRole,
                JSON.stringify(deliverableMetadata),
              ],
            );
            deliverableId = createdDeliverable.id;
          }

          if (executiveAssignment) {
            await systemQuery(
              `INSERT INTO agent_messages (from_agent, to_agent, thread_id, message, message_type, priority, status, context)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                agentRole, 'chief-of-staff', crypto.randomUUID(),
                `Directive '${(directive.title as string)?.slice(0, 80)}' — synthesized deliverable ready for review.`,
                'response', 'normal', 'pending',
                JSON.stringify({
                  directive_id: directiveId,
                  initiative_id: (directive as any).initiative_id ?? null,
                  assignment_id: executiveAssignment.id,
                  deliverable_id: deliverableId,
                }),
              ],
            );
          }

          // Emit event
          if (glyphorEventBus) {
            await glyphorEventBus.emit({
              type: 'assignment.submitted',
              source: agentRole,
              payload: {
                directive_id: directiveId,
                assignment_id: executiveAssignment?.id ?? null,
                assigned_by: 'chief-of-staff',
                status: 'completed',
                synthesized: true,
              },
              priority: 'normal',
            });
            await glyphorEventBus.emit({
              type: 'deliverable.published',
              source: agentRole,
              payload: {
                deliverable_id: deliverableId,
                initiative_id: (directive as any).initiative_id ?? null,
                directive_id: directiveId,
                assignment_id: deliverableAssignmentId,
                title: `Directive deliverable: ${directive.title as string}`,
                type: 'document',
                synthesized: true,
              },
              priority: 'high',
            });
          }

          // Log activity
          await systemQuery(
            'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
            [agentRole, agentRole, 'executive.deliverable_synthesized',
             `Synthesized ${completedAssignments.length} outputs for directive ${directiveId} into deliverable ${deliverableId}`, now],
          );

          return {
            success: true,
            data: {
              directive_id: directiveId,
              status: 'synthesized',
              deliverable_id: deliverableId,
              output_summary: {
                completed_assignments: completedAssignments.length,
                incomplete_assignments: incompleteCount?.count ?? 0,
                team_outputs: outputSummary,
              },
              executive_assignment_id: executiveAssignment?.id ?? null,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
