-- Agent claim evidence view + supporting index
--
-- agent_claim_evidence: joins task_run_outcomes + work_assignments + tool_call_traces
-- to surface the gap between what agents claimed and what runtime evidence shows.
--
-- Used by /admin/metrics/agent-ops endpoint.

CREATE OR REPLACE VIEW agent_claim_evidence AS
SELECT
  tro.id,
  tro.run_id,
  tro.agent_role,
  tro.final_status,
  tro.per_run_quality_score,
  tro.evidence_tier,
  tro.proof_of_work,
  tro.created_at,
  -- Output evidence from work_assignments
  CASE
    WHEN wa.agent_output IS NOT NULL AND LENGTH(wa.agent_output) >= 100 THEN true
    WHEN wa.agent_output IS NOT NULL AND LENGTH(wa.agent_output) > 0  THEN false
    ELSE false
  END AS has_meaningful_output,
  COALESCE(LENGTH(wa.agent_output), 0) AS output_length,
  -- Tool evidence aggregated from tool_call_traces
  COALESCE(tct.tool_calls_total,     0) AS tool_calls_total,
  COALESCE(tct.tool_calls_succeeded, 0) AS tool_calls_succeeded,
  COALESCE(tct.tool_calls_failed,    0) AS tool_calls_failed,
  -- Claim-vs-evidence verdict (backwards-compatible with pre-evidence_tier rows)
  CASE
    WHEN tro.evidence_tier IS NOT NULL
      THEN tro.evidence_tier                          -- use new column when available
    WHEN tro.final_status = 'submitted'
      AND (wa.agent_output IS NULL OR LENGTH(wa.agent_output) < 10)
      THEN 'self_reported'                            -- retro-classify old rows
    WHEN tct.tool_calls_failed > COALESCE(tct.tool_calls_succeeded, 0)
      THEN 'inconsistent'
    WHEN tro.final_status IN ('failed', 'aborted')
      THEN 'self_reported'
    ELSE 'partially_proven'
  END AS claim_evidence_status
FROM task_run_outcomes tro
LEFT JOIN work_assignments wa  ON wa.id  = tro.assignment_id
LEFT JOIN (
  SELECT
    run_id::text AS run_id_text,
    COUNT(*)                                         AS tool_calls_total,
    COUNT(*) FILTER (WHERE result_success = true)    AS tool_calls_succeeded,
    COUNT(*) FILTER (WHERE result_success = false)   AS tool_calls_failed
  FROM tool_call_traces
  GROUP BY run_id
) tct ON tct.run_id_text = tro.run_id::text;

-- Index to make the 7/30-day lookback in agent-ops fast
CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_created_at
  ON task_run_outcomes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_evidence_tier
  ON task_run_outcomes (evidence_tier)
  WHERE evidence_tier IS NOT NULL;
