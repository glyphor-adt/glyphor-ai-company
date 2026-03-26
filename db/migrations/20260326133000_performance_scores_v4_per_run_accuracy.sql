-- Performance Score v4 — make per-run outcome accuracy the backbone of the
-- platform-wide performance score so every agent execution contributes.
--
-- Weight model (normalized over available signals):
--   45% overall_accuracy   — avg(batch_quality_score or per_run_quality_score) across all runs
--   20% success_rate       — submitted / partial_progress share across all runs
--   15% output_quality     — executive/team review quality when available
--   10% constitutional     — constitutional adherence when available, neutral fallback 0.70
--    5% tool_accuracy      — tool selection quality when available
--    5% cos_quality        — Chief of Staff assessment when available, neutral fallback 0.50

CREATE OR REPLACE FUNCTION compute_performance_scores()
RETURNS TABLE(agent_role TEXT, new_score NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH run_metrics AS (
    SELECT
      ca.role AS agent_id,
      COUNT(tro.id) FILTER (
        WHERE COALESCE(tro.batch_quality_score, tro.per_run_quality_score) IS NOT NULL
      ) AS evaluated_run_count,
      AVG(COALESCE(tro.batch_quality_score, tro.per_run_quality_score) / 5.0) FILTER (
        WHERE COALESCE(tro.batch_quality_score, tro.per_run_quality_score) IS NOT NULL
      ) AS overall_accuracy,
      AVG(
        CASE
          WHEN tro.final_status IN ('submitted', 'partial_progress') THEN 1.0
          ELSE 0.0
        END
      ) AS success_rate
    FROM company_agents ca
    LEFT JOIN task_run_outcomes tro
      ON tro.agent_role = ca.role
     AND tro.created_at >= NOW() - INTERVAL '30 days'
    WHERE ca.status = 'active'
    GROUP BY ca.role
  ),
  assignment_metrics AS (
    SELECT
      ca.role AS agent_id,
      (
        SELECT AVG(ae.score_normalized)
        FROM assignment_evaluations ae
        INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
        WHERE wa.assigned_to = ca.role
          AND wa.created_at >= NOW() - INTERVAL '30 days'
          AND ae.evaluator_type = 'executive'
      ) AS exec_quality,
      (
        SELECT AVG(ae.score_normalized)
        FROM assignment_evaluations ae
        INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
        WHERE wa.assigned_to = ca.role
          AND wa.created_at >= NOW() - INTERVAL '30 days'
          AND ae.evaluator_type = 'team'
      ) AS team_quality,
      (
        SELECT AVG(ae.score_normalized)
        FROM assignment_evaluations ae
        INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
        WHERE wa.assigned_to = ca.role
          AND wa.created_at >= NOW() - INTERVAL '30 days'
          AND ae.evaluator_type = 'constitutional'
      ) AS constitutional_score,
      (
        SELECT AVG(ae.score_normalized)
        FROM assignment_evaluations ae
        INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
        WHERE wa.assigned_to = ca.role
          AND wa.created_at >= NOW() - INTERVAL '30 days'
          AND ae.evaluator_type = 'tool_accuracy'
      ) AS tool_accuracy,
      (
        SELECT AVG(ae.score_normalized)
        FROM assignment_evaluations ae
        INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
        WHERE wa.assigned_to = ca.role
          AND wa.created_at >= NOW() - INTERVAL '30 days'
          AND ae.evaluator_type = 'cos'
      ) AS cos_quality
    FROM company_agents ca
    WHERE ca.status = 'active'
  ),
  combined AS (
    SELECT
      r.agent_id,
      r.evaluated_run_count,
      r.overall_accuracy,
      r.success_rate,
      CASE
        WHEN a.exec_quality IS NOT NULL AND a.team_quality IS NOT NULL
          THEN (a.exec_quality + a.team_quality) / 2.0
        ELSE COALESCE(a.exec_quality, a.team_quality)
      END AS output_quality,
      a.constitutional_score,
      a.tool_accuracy,
      a.cos_quality
    FROM run_metrics r
    INNER JOIN assignment_metrics a ON a.agent_id = r.agent_id
  ),
  weighted AS (
    SELECT
      c.agent_id,
      CASE
        WHEN c.evaluated_run_count = 0 OR c.overall_accuracy IS NULL THEN NULL
        ELSE ROUND((
          (
            (COALESCE(c.overall_accuracy, 0) * 0.45) +
            (COALESCE(c.success_rate, 0) * 0.20) +
            (COALESCE(c.output_quality, 0) * CASE WHEN c.output_quality IS NULL THEN 0 ELSE 0.15 END) +
            (COALESCE(c.constitutional_score, 0.70) * 0.10) +
            (COALESCE(c.tool_accuracy, 0) * CASE WHEN c.tool_accuracy IS NULL THEN 0 ELSE 0.05 END) +
            (COALESCE(c.cos_quality, 0.50) * 0.05)
          ) /
          (
            0.45 +
            0.20 +
            0.10 +
            0.05 +
            CASE WHEN c.output_quality IS NULL THEN 0 ELSE 0.15 END +
            CASE WHEN c.tool_accuracy IS NULL THEN 0 ELSE 0.05 END
          )
        )::numeric, 4)
      END AS raw_score
    FROM combined c
  ),
  penalties AS (
    SELECT
      agent_id,
      LEAST(COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) * 0.15, 0.30)
      + LEAST(COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) * 0.05, 0.10)
      AS penalty_sum
    FROM fleet_findings
    GROUP BY agent_id
  )
  UPDATE company_agents ca
     SET performance_score = CASE
           WHEN w.raw_score IS NULL THEN NULL
           ELSE GREATEST(0, ROUND((w.raw_score - COALESCE(p.penalty_sum, 0))::numeric, 2))
         END,
         updated_at = NOW()
    FROM weighted w
    LEFT JOIN penalties p ON p.agent_id = w.agent_id
   WHERE ca.role = w.agent_id
  RETURNING ca.role AS agent_role, ca.performance_score AS new_score;
END;
$$ LANGUAGE plpgsql;