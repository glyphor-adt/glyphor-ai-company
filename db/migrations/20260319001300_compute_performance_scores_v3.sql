-- Performance Score v3 — Adds tool accuracy as 5th scoring component.
--
-- New weight distribution:
--   35% output quality    (exec + team avg)  — was 40%
--   20% success rate                         — was 25%
--   20% constitutional compliance            — unchanged
--   15% tool accuracy     (NEW)
--   10% CoS quality                          — was 15%
--
-- Fallback formulas redistribute weights when tool_accuracy or other data is missing,
-- so scores won't drop on first deploy (tool_accuracy starts NULL for all agents).

WITH agent_scores AS (
  SELECT
    wa.assigned_to AS agent_id,
    AVG(ae_exec.score_normalized)  AS exec_quality,
    AVG(ae_team.score_normalized)  AS team_quality,
    AVG(CASE WHEN tro.final_status = 'submitted' THEN 1.0 ELSE 0.0 END) AS success_rate,
    AVG(ae_con.score_normalized)   AS constitutional_score,
    AVG(ae_cos.score_normalized)   AS cos_quality,
    AVG(ae_tool.score_normalized)  AS tool_accuracy
  FROM work_assignments wa
  JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
  LEFT JOIN assignment_evaluations ae_exec ON ae_exec.assignment_id = wa.id AND ae_exec.evaluator_type = 'executive'
  LEFT JOIN assignment_evaluations ae_team ON ae_team.assignment_id = wa.id AND ae_team.evaluator_type = 'team'
  LEFT JOIN assignment_evaluations ae_con  ON ae_con.assignment_id  = wa.id AND ae_con.evaluator_type  = 'constitutional'
  LEFT JOIN assignment_evaluations ae_cos  ON ae_cos.assignment_id  = wa.id AND ae_cos.evaluator_type  = 'cos'
  LEFT JOIN assignment_evaluations ae_tool ON ae_tool.assignment_id = wa.id AND ae_tool.evaluator_type = 'tool_accuracy'
  GROUP BY wa.assigned_to
),
weighted AS (
  SELECT
    agent_id,
    CASE
      -- All components present (v3 full formula)
      WHEN exec_quality IS NOT NULL AND team_quality IS NOT NULL AND tool_accuracy IS NOT NULL THEN
        (((exec_quality + team_quality) / 2) * 0.35)
        + (success_rate * 0.20)
        + (COALESCE(constitutional_score, 0.7) * 0.20)
        + (tool_accuracy * 0.15)
        + (COALESCE(cos_quality, 0.5) * 0.10)

      -- No tool accuracy yet — fall back to v2 weights
      WHEN tool_accuracy IS NULL AND exec_quality IS NOT NULL AND team_quality IS NOT NULL THEN
        (((exec_quality + team_quality) / 2) * 0.40)
        + (success_rate * 0.25)
        + (COALESCE(constitutional_score, 0.7) * 0.20)
        + (COALESCE(cos_quality, 0.5) * 0.15)

      -- Minimal data — success rate dominant
      ELSE
        (success_rate * 0.60)
        + (COALESCE(constitutional_score, 0.7) * 0.25)
        + (COALESCE(cos_quality, 0.5) * 0.15)
    END AS performance_score
  FROM agent_scores
),
penalized AS (
  SELECT
    w.agent_id,
    GREATEST(0, w.performance_score - COALESCE(
      (SELECT LEAST(
        SUM(CASE WHEN severity = 'P0' THEN 0.15 ELSE 0.05 END),
        CASE WHEN EXISTS(SELECT 1 FROM fleet_findings f2 WHERE f2.agent_id = w.agent_id AND f2.severity = 'P0' AND f2.resolved_at IS NULL) THEN 0.30 ELSE 0.10 END
      )
      FROM fleet_findings f
      WHERE f.agent_id = w.agent_id AND f.resolved_at IS NULL),
    0)) AS performance_score
  FROM weighted w
)
UPDATE agents
SET performance_score = p.performance_score,
    updated_at = NOW()
FROM penalized p
WHERE agents.id = p.agent_id;
