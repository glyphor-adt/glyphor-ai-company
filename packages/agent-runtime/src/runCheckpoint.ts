import { systemQuery } from '@glyphor/shared/db';

/**
 * Structured checkpoint representing the state of a long-running agent task.
 * Saved when a run is interrupted (max_turns, timeout, stall) so the next
 * continuation run can resume from where it left off.
 */
export interface RunCheckpoint {
  runId: string;
  agentRole: string;
  task: string;
  assignmentId?: string;

  /** The execution plan produced during the planning phase. */
  executionPlan?: {
    objective?: string;
    executionSteps: string[];
    verificationSteps: string[];
  };

  /** Indices of completed execution steps (0-based). */
  completedSteps: number[];

  /** Key tool results per completed step: { stepIndex: { tool, summary } }. */
  stepResults: Record<string, { tool: string; summary: string }>;

  /** Acceptance criteria strings. */
  acceptanceCriteria: string[];

  /** Indices of acceptance criteria already satisfied. */
  satisfiedCriteria: number[];

  /** All action receipts from the run. */
  actionReceipts: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: 'success' | 'error';
    output: string;
    timestamp: string;
  }>;

  /** Last text the agent produced. */
  lastOutput: string | null;

  /** Why the run stopped. */
  abortReason: string;

  /** Turn number at checkpoint time. */
  turnNumber: number;

  totalInputTokens: number;
  totalOutputTokens: number;

  createdAt: string;
}

/**
 * Save a structured checkpoint at the end of a run that was interrupted.
 */
export async function saveRunCheckpoint(cp: Omit<RunCheckpoint, 'createdAt'>): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO run_checkpoints
        (run_id, agent_role, task, assignment_id,
         execution_plan, completed_steps, step_results,
         acceptance_criteria, satisfied_criteria,
         action_receipts, last_output, abort_reason,
         turn_number, total_input_tokens, total_output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        cp.runId,
        cp.agentRole,
        cp.task,
        cp.assignmentId ?? null,
        cp.executionPlan ? JSON.stringify(cp.executionPlan) : null,
        cp.completedSteps,
        JSON.stringify(cp.stepResults),
        cp.acceptanceCriteria,
        cp.satisfiedCriteria,
        JSON.stringify(cp.actionReceipts),
        cp.lastOutput?.slice(0, 10_000) ?? null,
        cp.abortReason,
        cp.turnNumber,
        cp.totalInputTokens,
        cp.totalOutputTokens,
      ],
    );
    console.log(`[Checkpoint] Saved for ${cp.agentRole} run=${cp.runId} at turn ${cp.turnNumber} (${cp.completedSteps.length} steps done)`);
  } catch (err) {
    console.warn(`[Checkpoint] Failed to save for ${cp.agentRole}:`, (err as Error).message);
  }
}

/**
 * Load the most recent checkpoint for an agent + assignment combination.
 * Used by continuation runs to restore state.
 * Only returns checkpoints from the last 4 hours to avoid stale context.
 */
export async function loadLatestCheckpoint(
  agentRole: string,
  assignmentId: string,
): Promise<RunCheckpoint | null> {
  try {
    const rows = await systemQuery<{
      run_id: string;
      agent_role: string;
      task: string;
      assignment_id: string | null;
      execution_plan: Record<string, unknown> | null;
      completed_steps: number[];
      step_results: Record<string, { tool: string; summary: string }>;
      acceptance_criteria: string[];
      satisfied_criteria: number[];
      action_receipts: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>;
      last_output: string | null;
      abort_reason: string;
      turn_number: number;
      total_input_tokens: number;
      total_output_tokens: number;
      created_at: string;
    }>(
      `SELECT * FROM run_checkpoints
       WHERE agent_role = $1 AND assignment_id = $2
         AND created_at > now() - interval '4 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [agentRole, assignmentId],
    );

    if (!rows?.length) return null;
    const row = rows[0];
    return {
      runId: row.run_id,
      agentRole: row.agent_role,
      task: row.task,
      assignmentId: row.assignment_id ?? undefined,
      executionPlan: row.execution_plan as RunCheckpoint['executionPlan'] ?? undefined,
      completedSteps: row.completed_steps ?? [],
      stepResults: row.step_results ?? {},
      acceptanceCriteria: row.acceptance_criteria ?? [],
      satisfiedCriteria: row.satisfied_criteria ?? [],
      actionReceipts: row.action_receipts ?? [],
      lastOutput: row.last_output,
      abortReason: row.abort_reason,
      turnNumber: row.turn_number,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.warn(`[Checkpoint] Failed to load for ${agentRole}/${assignmentId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Load a checkpoint by run_id (used when wake queue provides prior_run_id).
 */
export async function loadCheckpointByRunId(runId: string): Promise<RunCheckpoint | null> {
  try {
    const rows = await systemQuery<{
      run_id: string;
      agent_role: string;
      task: string;
      assignment_id: string | null;
      execution_plan: Record<string, unknown> | null;
      completed_steps: number[];
      step_results: Record<string, { tool: string; summary: string }>;
      acceptance_criteria: string[];
      satisfied_criteria: number[];
      action_receipts: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>;
      last_output: string | null;
      abort_reason: string;
      turn_number: number;
      total_input_tokens: number;
      total_output_tokens: number;
      created_at: string;
    }>(
      `SELECT * FROM run_checkpoints WHERE run_id = $1 LIMIT 1`,
      [runId],
    );

    if (!rows?.length) return null;
    const row = rows[0];
    return {
      runId: row.run_id,
      agentRole: row.agent_role,
      task: row.task,
      assignmentId: row.assignment_id ?? undefined,
      executionPlan: row.execution_plan as RunCheckpoint['executionPlan'] ?? undefined,
      completedSteps: row.completed_steps ?? [],
      stepResults: row.step_results ?? {},
      acceptanceCriteria: row.acceptance_criteria ?? [],
      satisfiedCriteria: row.satisfied_criteria ?? [],
      actionReceipts: row.action_receipts ?? [],
      lastOutput: row.last_output,
      abortReason: row.abort_reason,
      turnNumber: row.turn_number,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.warn(`[Checkpoint] Failed to load by run_id ${runId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Compose a continuation prompt from a checkpoint — injected at the start
 * of a continuation run so the agent knows what was already done.
 */
export function composeContinuationPrompt(cp: RunCheckpoint): string {
  const parts: string[] = [];

  parts.push(`## Continuation from Prior Run`);
  parts.push(`This is a CONTINUATION of a previous run (${cp.runId}) that was interrupted: ${cp.abortReason}.`);
  parts.push(`You used ${cp.turnNumber} turns and ${cp.totalInputTokens + cp.totalOutputTokens} tokens before stopping.`);
  parts.push(`DO NOT redo completed work. Resume from where you left off.`);

  if (cp.executionPlan) {
    parts.push(`\n### Execution Plan`);
    if (cp.executionPlan.objective) {
      parts.push(`**Objective:** ${cp.executionPlan.objective}`);
    }
    parts.push(`**Steps:**`);
    cp.executionPlan.executionSteps.forEach((step, i) => {
      const done = cp.completedSteps.includes(i);
      const result = cp.stepResults[String(i)];
      if (done && result) {
        parts.push(`${i + 1}. ✅ ${step} — Done via \`${result.tool}\`: ${result.summary}`);
      } else if (done) {
        parts.push(`${i + 1}. ✅ ${step} — Done`);
      } else {
        parts.push(`${i + 1}. ⬜ ${step} — NOT YET DONE`);
      }
    });
  }

  if (cp.acceptanceCriteria.length > 0) {
    parts.push(`\n### Acceptance Criteria`);
    cp.acceptanceCriteria.forEach((criterion, i) => {
      const satisfied = cp.satisfiedCriteria.includes(i);
      parts.push(`${i + 1}. ${satisfied ? '✅' : '⬜'} ${criterion}`);
    });
  }

  if (cp.actionReceipts.length > 0) {
    const successful = cp.actionReceipts.filter(r => r.result === 'success');
    const failed = cp.actionReceipts.filter(r => r.result === 'error');
    parts.push(`\n### Prior Tool Calls`);
    parts.push(`${successful.length} successful, ${failed.length} failed.`);
    // Show last 5 successful receipts as context
    const recentSuccess = successful.slice(-5);
    if (recentSuccess.length > 0) {
      parts.push(`Recent successful calls:`);
      for (const r of recentSuccess) {
        parts.push(`- \`${r.tool}\`: ${r.output.slice(0, 200)}`);
      }
    }
  }

  if (cp.lastOutput) {
    parts.push(`\n### Last Output Before Interruption`);
    parts.push(cp.lastOutput.slice(0, 2000));
  }

  parts.push(`\n### Instructions`);
  parts.push(`Resume execution from the first ⬜ step. Do NOT re-plan. Do NOT redo completed steps. Use your tools to complete remaining work.`);

  return parts.join('\n');
}

/**
 * Clean up checkpoints older than the retention period.
 */
export async function cleanupOldCheckpoints(retentionHours = 72): Promise<number> {
  try {
    const result = await systemQuery<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM run_checkpoints WHERE created_at < now() - interval '1 hour' * $1
         RETURNING 1
       ) SELECT count(*)::text AS count FROM deleted`,
      [retentionHours],
    );
    const count = parseInt(result?.[0]?.count ?? '0', 10);
    if (count > 0) {
      console.log(`[Checkpoint] Cleaned up ${count} old checkpoints (>${retentionHours}h)`);
    }
    return count;
  } catch (err) {
    console.warn('[Checkpoint] Cleanup failed:', (err as Error).message);
    return 0;
  }
}
