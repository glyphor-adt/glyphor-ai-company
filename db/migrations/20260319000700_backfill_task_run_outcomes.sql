-- Backfill task_run_outcomes from agent_runs for all completed/failed/aborted runs
-- that don't yet have an outcome row. This creates the linkage needed for the
-- eval scoring chain to function.

INSERT INTO task_run_outcomes (
  run_id, agent_role, assignment_id, directive_id,
  final_status, turn_count, tool_call_count, tool_failure_count,
  had_partial_save, elapsed_ms, cost_usd, input_tokens, output_tokens,
  per_run_quality_score, per_run_evaluation_notes,
  backfill_source
)
SELECT
  ar.id AS run_id,
  ar.agent_id AS agent_role,
  -- Link to work_assignments if one exists for this agent with a matching time window
  wa.id AS assignment_id,
  NULL::uuid AS directive_id,
  CASE
    WHEN ar.status = 'completed' THEN 'submitted'
    WHEN ar.status = 'failed' THEN 'failed'
    WHEN ar.status = 'aborted' THEN 'aborted'
    ELSE 'partial_progress'
  END AS final_status,
  COALESCE(ar.turns, 0) AS turn_count,
  COALESCE(ar.tool_calls, 0) AS tool_call_count,
  0 AS tool_failure_count,
  FALSE AS had_partial_save,
  COALESCE(ar.duration_ms, 0) AS elapsed_ms,
  COALESCE(ar.cost, 0) AS cost_usd,
  COALESCE(ar.input_tokens, 0) AS input_tokens,
  COALESCE(ar.output_tokens, 0) AS output_tokens,
  -- Compute per-run quality score from available signals
  GREATEST(1.0, LEAST(5.0,
    3.0
    + CASE WHEN ar.status = 'completed' THEN 0.5 ELSE 0 END
    + CASE WHEN COALESCE(ar.tool_calls, 0) > 0 THEN 0.2 ELSE 0 END
    - CASE WHEN ar.status IN ('aborted', 'failed') THEN 1.0 ELSE 0 END
    - CASE WHEN COALESCE(ar.turns, 0) > 15 THEN 0.2 ELSE 0 END
    - CASE WHEN COALESCE(ar.cost, 0) > 0.50 THEN 0.1 ELSE 0 END
  )) AS per_run_quality_score,
  'backfill from agent_runs' AS per_run_evaluation_notes,
  'agent_runs_backfill' AS backfill_source
FROM agent_runs ar
LEFT JOIN work_assignments wa ON (
  wa.assigned_to = ar.agent_id
  AND wa.status IN ('completed', 'pending', 'needs_revision')
  AND wa.created_at <= ar.created_at
  AND (wa.updated_at >= ar.created_at - INTERVAL '1 hour' OR wa.status = 'pending')
)
WHERE ar.status IN ('completed', 'failed', 'aborted')
  AND NOT EXISTS (
    SELECT 1 FROM task_run_outcomes tro WHERE tro.run_id = ar.id
  )
ON CONFLICT (run_id) DO NOTHING;
