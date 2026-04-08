/**
 * Task Outcome Harvester — Post-run signal capture for the Learning Governor.
 *
 * Extracts structured outcome data from completed agent runs and persists it
 * to `task_run_outcomes` for downstream analysis (skill-gap detection,
 * curriculum generation, trust calibration).
 *
 * All writes are fire-and-forget — harvesting failures must never block or
 * break the agent run pipeline.
 *
 * Evidence classification added 2026-04-08:
 *   Completion claims are now classified by evidence tier rather than accepted
 *   at face value.  A submitted run with trivially short output is downgraded
 *   to partial_progress and tagged self_reported before writing.
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

export type EvidenceTier = 'proven' | 'partially_proven' | 'self_reported' | 'inconsistent';

// ─── Immediate quality scoring ──────────────────────────────────

interface ImmediateScoreInput {
  final_status: TaskRunOutcome['final_status'];
  turn_count: number;
  tool_failure_count: number;
  had_partial_save: boolean;
  cost_usd: number;
}

/**
 * Compute a quality score (1.0–5.0) from signals available immediately at
 * run completion, before any downstream acceptance or revision signals arrive.
 * Mirrors the batch evaluator's logic for the subset of signals that are
 * deterministic at run time.
 */
export function computePerRunQualityScore(o: ImmediateScoreInput): { score: number; notes: string } {
  let score = 3.0;
  const signals: string[] = [];

  // Positive signals
  if (o.final_status === 'submitted') {
    score += 0.5;
    signals.push('+0.5 submitted');
  }

  if (o.tool_failure_count === 0) {
    score += 0.2;
    signals.push('+0.2 no tool failures');
  }

  if (o.turn_count <= 5 && o.final_status === 'submitted') {
    score += 0.2;
    signals.push('+0.2 efficient submit');
  }

  // Negative signals
  if (o.final_status === 'aborted' || o.final_status === 'failed') {
    score -= 1.0;
    signals.push('-1.0 ' + o.final_status);
  }

  if (o.final_status === 'flagged_blocker') {
    score -= 0.5;
    signals.push('-0.5 flagged_blocker');
  }

  if (o.tool_failure_count > 3) {
    score -= 0.3;
    signals.push('-0.3 high tool failures');
  }

  if (o.had_partial_save) {
    score -= 0.2;
    signals.push('-0.2 partial save');
  }

  if (o.turn_count > 15) {
    score -= 0.2;
    signals.push('-0.2 high turn count');
  }

  if (Number(o.cost_usd) > 0.50) {
    score -= 0.1;
    signals.push('-0.1 high cost');
  }

  score = Math.max(1.0, Math.min(5.0, Math.round(score * 10) / 10));
  return { score, notes: signals.join('; ') || 'baseline' };
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

// ─── Proof snapshot ─────────────────────────────────────────────

interface ProofSnapshot {
  output_length: number;        // length of work_assignments.agent_output at harvest time
  tool_calls_succeeded: number; // actions with result === 'success'
  tool_calls_failed: number;    // actions with result === 'error'
  has_meaningful_output: boolean; // output_length >= MIN_MEANINGFUL_OUTPUT_LENGTH
}

// Minimum output length to treat a submission as having meaningful content.
// Below this threshold a 'submitted' claim is downgraded to 'partial_progress'.
const MIN_MEANINGFUL_OUTPUT_LENGTH = 100;

async function buildProofSnapshot(
  assignmentId: string | undefined,
  actions: ActionReceipt[],
): Promise<ProofSnapshot> {
  const toolCallsSucceeded = actions.filter(a => a.result === 'success').length;
  const toolCallsFailed = actions.filter(a => a.result === 'error').length;

  let outputLength = 0;
  if (assignmentId) {
    try {
      const rows = await systemQuery<{ len: string }>(
        'SELECT COALESCE(LENGTH(agent_output), 0) AS len FROM work_assignments WHERE id = $1',
        [assignmentId],
      );
      outputLength = parseInt(rows?.[0]?.len ?? '0', 10) || 0;
    } catch {
      // Non-blocking — snapshot degrades gracefully; outputLength stays 0
    }
  }

  return {
    output_length: outputLength,
    tool_calls_succeeded: toolCallsSucceeded,
    tool_calls_failed: toolCallsFailed,
    has_meaningful_output: outputLength >= MIN_MEANINGFUL_OUTPUT_LENGTH,
  };
}

// ─── Evidence tier classification ───────────────────────────────

/**
 * Classify how strongly runtime evidence supports the completion claim.
 *
 * proven           — submitted + meaningful output + tool work beyond submit itself
 * partially_proven — submitted with meaningful output OR non-trivial tool work, but not both
 * self_reported    — claimed done but insufficient evidence (output too short, no tool proof)
 * inconsistent     — majority of tool calls failed despite claimed success
 */
function classifyEvidenceTier(
  finalStatus: TaskRunOutcome['final_status'],
  proof: ProofSnapshot,
  toolCallCount: number,
): EvidenceTier {
  // Inconsistent: more tool failures than successes on a claimed submission
  if (
    finalStatus === 'submitted' &&
    proof.tool_calls_failed > proof.tool_calls_succeeded
  ) {
    return 'inconsistent';
  }

  if (finalStatus === 'failed' || finalStatus === 'aborted') return 'self_reported';
  if (finalStatus === 'flagged_blocker') return 'partially_proven';

  if (finalStatus === 'submitted') {
    // tool_calls_succeeded > 1 means at least one successful tool call beyond submit itself
    const hasToolWork = proof.tool_calls_succeeded > 1;
    if (proof.has_meaningful_output && hasToolWork) return 'proven';
    if (proof.has_meaningful_output || hasToolWork) return 'partially_proven';
    // Submit tool called successfully but no real output evidence
    return 'self_reported';
  }

  // partial_progress
  if (toolCallCount > 0 && proof.tool_calls_succeeded > 0) return 'partially_proven';
  return 'self_reported';
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
  let finalStatus = deriveFinalStatus(result, actions);

  // Build proof snapshot — queries agent_output from work_assignments if available.
  // Failure is non-blocking; snapshot defaults to zero-length output.
  const proof = await buildProofSnapshot(runMeta.assignmentId, actions);

  // Downgrade: agent called submit_assignment_output successfully but the stored output
  // is too short to constitute a real submission.  This stops trivial completions from
  // inflating quality scores and appearing as 'submitted' in the audit trail.
  let downgradedFromSubmit = false;
  if (finalStatus === 'submitted' && runMeta.assignmentId && !proof.has_meaningful_output) {
    finalStatus = 'partial_progress';
    downgradedFromSubmit = true;
  }

  const evidenceTier = classifyEvidenceTier(finalStatus, proof, toolCallCount);

  const proofOfWork = {
    output_length: proof.output_length,
    tool_calls_succeeded: proof.tool_calls_succeeded,
    tool_calls_failed: proof.tool_calls_failed,
    has_meaningful_output: proof.has_meaningful_output,
    ...(downgradedFromSubmit && { downgraded_from: 'submitted', downgrade_reason: 'output_too_short' }),
  };

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

  const { score: perRunScore, notes: perRunNotes } = computePerRunQualityScore({
    final_status: finalStatus,
    turn_count: result.totalTurns,
    tool_failure_count: toolFailureCount,
    had_partial_save: hadPartialSave,
    cost_usd: result.cost,
  });

  const notesWithTier = downgradedFromSubmit
    ? `[DOWNGRADED: output_too_short] ${perRunNotes}`
    : `[evidence:${evidenceTier}] ${perRunNotes}`;

  await systemQuery(
    `INSERT INTO task_run_outcomes (
       run_id, agent_role, directive_id, assignment_id,
       final_status, turn_count, tool_call_count, tool_failure_count,
       had_partial_save, elapsed_ms, cost_usd, input_tokens, output_tokens,
       per_run_quality_score, per_run_evaluation_notes,
       proof_of_work, evidence_tier
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      perRunScore,
      notesWithTier,
      JSON.stringify(proofOfWork),
      evidenceTier,
    ],
  );
}

// ─── Downstream signal helpers ──────────────────────────────────

/** Mark the outcome row as having been sent back for revision. */
export async function markOutcomeRevised(assignmentId: string): Promise<void> {
  await systemQuery(
    `UPDATE task_run_outcomes tro
       SET downstream_status = 'revised',
           was_revised = true,
           revision_count = COALESCE(tro.revision_count, 0) + 1,
           updated_at = NOW()
     FROM (
       SELECT id FROM task_run_outcomes
       WHERE assignment_id = $1 AND downstream_status IS NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) pick
     WHERE tro.id = pick.id`,
    [assignmentId],
  );
}

/** Mark the outcome row as accepted by the orchestrator. */
export async function markOutcomeAccepted(assignmentId: string, submittedAt?: Date): Promise<void> {
  const ts = submittedAt?.toISOString() ?? new Date().toISOString();
  await systemQuery(
    `UPDATE task_run_outcomes tro
       SET downstream_status = 'accepted',
           accepted_at = $2,
           was_accepted = true,
           updated_at = NOW()
     FROM (
       SELECT id FROM task_run_outcomes
       WHERE assignment_id = $1 AND downstream_status IS NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) pick
     WHERE tro.id = pick.id`,
    [assignmentId, ts],
  );
}

