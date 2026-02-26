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

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

/* ── Dependency Resolution ────────────────── */

/**
 * When an assignment completes, check if any dependent assignments now have
 * ALL dependencies met. If so, dispatch them immediately via the scheduler.
 * Fire-and-forget — errors are logged but don't block the submitting agent.
 */
async function dispatchDependentAssignments(
  supabase: SupabaseClient,
  completedAssignmentId: string,
): Promise<void> {
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://localhost:8080';

  // Find assignments that depend on the completed one
  const { data: dependents } = await supabase
    .from('work_assignments')
    .select('id, assigned_to, task_description, depends_on')
    .contains('depends_on', [completedAssignmentId])
    .in('status', ['pending', 'dispatched']);

  if (!dependents?.length) return;

  for (const dep of dependents) {
    const allDeps: string[] = (dep.depends_on as string[]) ?? [];

    // Check if ALL dependencies are now completed
    const { data: completed } = await supabase
      .from('work_assignments')
      .select('id')
      .in('id', allDeps)
      .eq('status', 'completed');

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
  supabase: SupabaseClient,
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

        let query = supabase
          .from('work_assignments')
          .select(`
            id, task_description, task_type, expected_output, status,
            priority, sequence_order, agent_output, evaluation, quality_score,
            dispatched_at, completed_at, created_at, updated_at,
            founder_directives (
              id, title, description, priority, category, status, due_date
            )
          `)
          .eq('assigned_to', ctx.agentRole);

        if (statusFilter) {
          query = query.eq('status', statusFilter);
        } else {
          // Default: show actionable assignments
          query = query.in('status', ['pending', 'dispatched', 'in_progress', 'needs_revision']);
        }

        query = query
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true });

        const { data, error } = await query;

        if (error) {
          return { success: false, error: error.message };
        }

        const assignments = (data ?? []).map((a: Record<string, unknown>) => {
          const directive = a.founder_directives as Record<string, unknown> | null;
          return {
            id: a.id,
            title: (a.task_description as string)?.slice(0, 100),
            instructions: a.task_description,
            expected_output: a.expected_output,
            status: a.status,
            priority: a.priority,
            directive_title: directive?.title ?? null,
            directive_priority: directive?.priority ?? null,
            directive_description: directive?.description ?? null,
            directive_due_date: directive?.due_date ?? null,
            feedback: a.status === 'needs_revision' ? a.evaluation : null,
            quality_score: a.quality_score,
            assigned_at: a.dispatched_at ?? a.created_at,
          };
        });

        return {
          success: true,
          data: {
            count: assignments.length,
            assignments,
          },
        };
      },
    },

    /* ── submit_assignment_output ─────────── */
    {
      name: 'submit_assignment_output',
      description:
        'Submit your completed work for a specific assignment. Include your full deliverable. Sarah will evaluate the quality and either accept it or send it back with feedback. Use status "completed" for final submissions, "in_progress" for partial updates with progress notes.',
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

        // Verify the assignment belongs to this agent
        const { data: assignment, error: fetchErr } = await supabase
          .from('work_assignments')
          .select('id, assigned_to, task_description, directive_id')
          .eq('id', assignmentId)
          .single();

        if (fetchErr || !assignment) {
          return { success: false, error: 'Assignment not found' };
        }
        if (assignment.assigned_to !== ctx.agentRole) {
          return { success: false, error: 'This assignment is not assigned to you' };
        }

        // Build update
        const now = new Date().toISOString();
        const updates: Record<string, unknown> = {
          agent_output: output,
          status,
          updated_at: now,
        };
        if (status === 'completed') {
          updates.completed_at = now;
        }

        // Check if this is the first work — set dispatched_at if not already set
        const { data: current } = await supabase
          .from('work_assignments')
          .select('dispatched_at')
          .eq('id', assignmentId)
          .single();
        if (current && !current.dispatched_at) {
          updates.dispatched_at = now;
        }

        const { error: updateErr } = await supabase
          .from('work_assignments')
          .update(updates)
          .eq('id', assignmentId);

        if (updateErr) {
          return { success: false, error: updateErr.message };
        }

        // Notify Sarah
        const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';
        const msgContent = status === 'completed'
          ? `Assignment '${title}' completed. Output submitted for review.`
          : `Assignment '${title}' progress update submitted.`;

        await supabase.from('agent_messages').insert({
          from_agent: ctx.agentRole,
          to_agent: 'chief-of-staff',
          thread_id: crypto.randomUUID(),
          message: msgContent,
          message_type: 'response',
          priority: 'normal',
          status: 'pending',
          context: { assignment_id: assignmentId, directive_id: assignment.directive_id },
        });

        // Emit event
        await glyphorEventBus.emit({
          type: 'assignment.submitted',
          source: ctx.agentRole,
          payload: {
            assignment_id: assignmentId,
            directive_id: assignment.directive_id,
            status,
          },
          priority: 'normal',
        });

        // Event-driven dependency resolution: dispatch agents whose deps are now met
        if (status === 'completed') {
          dispatchDependentAssignments(supabase, assignmentId).catch(err => {
            console.warn('[DependencyResolution] Failed:', (err as Error).message);
          });
        }

        // Log to activity_log
        await supabase.from('activity_log').insert({
          agent_id: ctx.agentRole,
          action: status === 'completed' ? 'assignment.completed' : 'assignment.progress',
          detail: `${status === 'completed' ? 'Completed' : 'Updated'} assignment: ${title}`,
          created_at: now,
        });

        return {
          success: true,
          data: {
            assignment_id: assignmentId,
            status,
            message: 'Output submitted. Sarah will evaluate.',
          },
        };
      },
    },

    /* ── flag_assignment_blocker ──────────── */
    {
      name: 'flag_assignment_blocker',
      description:
        'Flag a work assignment as blocked. Describe what is preventing you from completing the work and what you need to proceed. Sarah will triage: reassign, escalate to founders, or dispatch another agent to help.',
      parameters: {
        assignment_id: {
          type: 'string',
          description: 'The assignment UUID',
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

        // Verify the assignment belongs to this agent
        const { data: assignment, error: fetchErr } = await supabase
          .from('work_assignments')
          .select('id, assigned_to, task_description, directive_id')
          .eq('id', assignmentId)
          .single();

        if (fetchErr || !assignment) {
          return { success: false, error: 'Assignment not found' };
        }
        if (assignment.assigned_to !== ctx.agentRole) {
          return { success: false, error: 'This assignment is not assigned to you' };
        }

        const now = new Date().toISOString();
        const title = (assignment.task_description as string)?.slice(0, 80) ?? 'Assignment';

        // Update assignment status to blocked
        const { error: updateErr } = await supabase
          .from('work_assignments')
          .update({
            status: 'blocked',
            agent_output: `BLOCKED: ${blockerReason}\nNeed type: ${needType}`,
            updated_at: now,
          })
          .eq('id', assignmentId);

        if (updateErr) {
          return { success: false, error: updateErr.message };
        }

        // Send urgent message to Sarah
        await supabase.from('agent_messages').insert({
          from_agent: ctx.agentRole,
          to_agent: 'chief-of-staff',
          thread_id: crypto.randomUUID(),
          message: `BLOCKED: Assignment '${title}'\nReason: ${blockerReason}\nNeed: ${needType}`,
          message_type: 'alert',
          priority: 'urgent',
          status: 'pending',
          context: { assignment_id: assignmentId, directive_id: assignment.directive_id, need_type: needType },
        });

        // Emit alert event
        await glyphorEventBus.emit({
          type: 'alert.triggered',
          source: ctx.agentRole,
          payload: {
            title: `Assignment blocked: ${title}`,
            description: blockerReason,
            assignment_id: assignmentId,
            directive_id: assignment.directive_id,
            need_type: needType,
          },
          priority: 'high',
        });

        // Log to activity_log
        await supabase.from('activity_log').insert({
          agent_id: ctx.agentRole,
          action: 'assignment.blocked',
          detail: `Blocked on assignment: ${title} — ${blockerReason}`,
          created_at: now,
        });

        return {
          success: true,
          data: {
            assignment_id: assignmentId,
            status: 'blocked',
            message: 'Blocker flagged. Sarah will triage.',
          },
        };
      },
    },
  ];
}
