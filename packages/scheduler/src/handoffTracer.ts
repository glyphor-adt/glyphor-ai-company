/**
 * Handoff Tracer — Records inter-agent handoffs within a directive.
 *
 * When a directive completes, identifies sequential agent runs and
 * records the upstream→downstream handoff for quality evaluation.
 */

import { systemQuery } from '@glyphor/shared/db';

const LOG_PREFIX = '[HandoffTracer]';

interface DirectiveRun {
  run_id: string;
  agent_id: string;
  created_at: string;
  status: string;
  assignment_id: string;
  assigned_by: string | null;
}

export async function traceHandoffs(directiveId: string): Promise<number> {
  const runs = await systemQuery<DirectiveRun>(`
    SELECT ar.id AS run_id, ar.agent_id, ar.created_at, ar.status,
           wa.id AS assignment_id, wa.assigned_by
    FROM agent_runs ar
    JOIN work_assignments wa ON wa.id = ar.assignment_id
    WHERE wa.directive_id = $1
    ORDER BY ar.created_at ASC
  `, [directiveId]);

  if (runs.length < 2) return 0;

  let traced = 0;

  for (let i = 1; i < runs.length; i++) {
    const upstream   = runs[i - 1];
    const downstream = runs[i];

    // Skip same-agent sequential runs (retries)
    if (upstream.agent_id === downstream.agent_id) continue;

    const upstreamScore = await getAssignmentQualityScore(upstream.assignment_id);

    try {
      await systemQuery(`
        INSERT INTO handoff_traces
        (upstream_agent_id, downstream_agent_id,
         upstream_run_id, downstream_run_id,
         upstream_assignment_id, downstream_assignment_id,
         directive_id, handoff_type, upstream_output_quality)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'sequential',$8)
        ON CONFLICT DO NOTHING
      `, [
        upstream.agent_id,
        downstream.agent_id,
        upstream.run_id,
        downstream.run_id,
        upstream.assignment_id,
        downstream.assignment_id,
        directiveId,
        upstreamScore,
      ]);
      traced++;
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to insert handoff trace:`, (err as Error).message);
    }
  }

  if (traced > 0) {
    console.log(`${LOG_PREFIX} Traced ${traced} handoffs for directive ${directiveId}`);
  }
  return traced;
}

async function getAssignmentQualityScore(assignmentId: string): Promise<number | null> {
  const rows = await systemQuery<{ avg_score: number | null }>(`
    SELECT AVG(score_normalized) AS avg_score
    FROM assignment_evaluations
    WHERE assignment_id = $1
    AND evaluator_type IN ('executive', 'team')
  `, [assignmentId]);
  return rows[0]?.avg_score ?? null;
}
