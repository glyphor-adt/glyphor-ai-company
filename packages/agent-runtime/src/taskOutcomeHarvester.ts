/**
 * Task Outcome Harvester — Post-run signal capture for the Learning Governor.
 *
 * Extracts structured outcome data from completed agent runs and persists it
 * to `task_run_outcomes` for downstream analysis (skill-gap detection,
 * curriculum generation, trust calibration).
 *
 * All writes are fire-and-forget — harvesting failures must never block or
 * break the agent run pipeline.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { AgentExecutionResult, ActionReceipt } from './types.js';

// ─── Public types ────────────────────────────────────────────────

export interface TaskRunOutcome {
  run_id: string;
  agent_role: string;
  directive_id?: string;
  assignment_id?: string;
  final_status: 'submitted' | 'flagged_blocker' | 'partial_progress' | 'aborted' | 'failed';
  turn_count: number;
  tool_call_count: number;
  tool_failure_count: number;
  had_partial_save: boolean;
  elapsed_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

// ─── Status derivation ──────────────────────────────────────────

function deriveFinalStatus(
  result: AgentExecutionResult,
  actions: ActionReceipt[],
): TaskRunOutcome['final_status'] {
  if (result.status === 'error') return 'failed';
  if (result.status === 'aborted') return 'aborted';

  // Check tool calls for explicit submission / blocker signals
  const hasSubmit = actions.some(a => a.tool === 'submit_assignment_output' && a.result === 'success');
  if (hasSubmit) return 'submitted';

  const hasBlocker = actions.some(a => a.tool === 'flag_assignment_blocker' && a.result === 'success');
  if (hasBlocker) return 'flagged_blocker';

  // Completed but no explicit submission — partial progress
  return 'partial_progress';
}

// ─── Main harvester ─────────────────────────────────────────────

export interface HarvestRunMeta {
  runId: string;
  agentRole: string;
  assignmentId?: string;
  directiveId?: string;
}

export async function harvestTaskOutcome(
  result: AgentExecutionResult,
  runMeta: HarvestRunMeta,
): Promise<void> {
  const actions = result.actions ?? [];

  const toolCallCount = actions.length;
  const toolFailureCount = actions.filter(a => a.result === 'error').length;
  const hadPartialSave = actions.some(a => a.tool === 'save_partial_output' && a.result === 'success');
  const finalStatus = deriveFinalStatus(result, actions);

  const outcome: TaskRunOutcome = {
    run_id: runMeta.runId,
    agent_role: runMeta.agentRole,
    directive_id: runMeta.directiveId,
    assignment_id: runMeta.assignmentId,
    final_status: finalStatus,
    turn_count: result.totalTurns,
    tool_call_count: toolCallCount,
    tool_failure_count: toolFailureCount,
    had_partial_save: hadPartialSave,
    elapsed_ms: result.elapsedMs,
    cost_usd: result.cost,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  };

  await systemQuery(
    `INSERT INTO task_run_outcomes (
       run_id, agent_role, directive_id, assignment_id,
       final_status, turn_count, tool_call_count, tool_failure_count,
       had_partial_save, elapsed_ms, cost_usd, input_tokens, output_tokens
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (run_id) DO NOTHING`,
    [
      outcome.run_id,
      outcome.agent_role,
      outcome.directive_id ?? null,
      outcome.assignment_id ?? null,
      outcome.final_status,
      outcome.turn_count,
      outcome.tool_call_count,
      outcome.tool_failure_count,
      outcome.had_partial_save,
      outcome.elapsed_ms,
      outcome.cost_usd,
      outcome.input_tokens,
      outcome.output_tokens,
    ],
  );
}

// ─── Downstream signal helpers ──────────────────────────────────

/** Mark the outcome row as having been sent back for revision. */
export async function markOutcomeRevised(assignmentId: string): Promise<void> {
  await systemQuery(
    `UPDATE task_run_outcomes
       SET downstream_status = 'revised', updated_at = NOW()
     WHERE assignment_id = $1
       AND downstream_status IS NULL`,
    [assignmentId],
  );
}

/** Mark the outcome row as accepted by the orchestrator. */
export async function markOutcomeAccepted(assignmentId: string, submittedAt?: Date): Promise<void> {
  await systemQuery(
    `UPDATE task_run_outcomes
       SET downstream_status = 'accepted',
           accepted_at = $2,
           updated_at = NOW()
     WHERE assignment_id = $1
       AND downstream_status IS NULL`,
    [assignmentId, submittedAt?.toISOString() ?? new Date().toISOString()],
  );
}
