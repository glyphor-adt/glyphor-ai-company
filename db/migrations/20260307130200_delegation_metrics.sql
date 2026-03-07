-- Materialized view for delegation performance comparison.
-- Enables side-by-side comparison of Sarah vs executive orchestration quality.

CREATE MATERIALIZED VIEW IF NOT EXISTS delegation_performance AS
SELECT
  wa.created_by,
  CASE WHEN wa.created_by = 'chief-of-staff' THEN 'sarah' ELSE 'executive' END AS orchestrator_type,
  wa.created_by AS orchestrator_role,
  COUNT(*) AS total_assignments,
  COUNT(*) FILTER (WHERE wa.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE wa.status = 'needs_revision') AS revised,
  COUNT(*) FILTER (WHERE wa.status = 'blocked') AS blocked,
  AVG(tro.batch_quality_score) FILTER (WHERE tro.batch_quality_score IS NOT NULL) AS avg_quality,
  AVG(tro.turn_count) AS avg_turns,
  AVG(tro.elapsed_ms) AS avg_elapsed_ms,
  AVG(tro.cost_usd) AS avg_cost,
  COUNT(*) FILTER (WHERE tro.was_revised = true)::FLOAT / NULLIF(COUNT(*), 0) AS revision_rate,
  COUNT(*) FILTER (WHERE tro.was_accepted = true AND tro.revision_count = 0)::FLOAT 
    / NULLIF(COUNT(*) FILTER (WHERE tro.was_accepted IS NOT NULL), 0) AS first_time_accept_rate,
  COUNT(*) FILTER (WHERE tro.final_status IN ('aborted', 'failed'))::FLOAT 
    / NULLIF(COUNT(*), 0) AS failure_rate
FROM work_assignments wa
LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
WHERE wa.created_at > NOW() - INTERVAL '30 days'
GROUP BY wa.created_by;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegation_perf_role ON delegation_performance(orchestrator_role);

CREATE OR REPLACE FUNCTION refresh_delegation_metrics() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY delegation_performance;
END;
$$ LANGUAGE plpgsql;
