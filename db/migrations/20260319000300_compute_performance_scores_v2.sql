-- Step 6 + Step 8c: Replace the 40/30/30 performance score formula with a
-- 40/25/20/15 output-quality-weighted formula based on assignment_evaluations.
-- Includes fleet_findings penalty subtraction.

CREATE OR REPLACE FUNCTION compute_performance_scores()
RETURNS TABLE(agent_role TEXT, new_score NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH agent_scores AS (
    SELECT
      ca.role AS agent_id,

      -- Output quality: average of executive + team normalized scores (weight: 40%)
      AVG(ae_exec.score_normalized) AS exec_quality,
      AVG(ae_team.score_normalized) AS team_quality,

      -- Success rate: completed runs without abort (weight: 25%)
      AVG(CASE WHEN tro.final_status IN ('submitted', 'partial_progress') THEN 1.0 ELSE 0.0 END) AS success_rate,

      -- Constitutional compliance (weight: 20%)
      AVG(ae_const.score_normalized) AS constitutional_score,

      -- CoS quality grade (weight: 15%)
      AVG(ae_cos.score_normalized) AS cos_quality

    FROM company_agents ca
    LEFT JOIN task_run_outcomes tro
      ON tro.agent_role = ca.role
      AND tro.created_at >= NOW() - INTERVAL '30 days'
    LEFT JOIN assignment_evaluations ae_exec
      ON ae_exec.assignment_id = tro.assignment_id
      AND ae_exec.evaluator_type = 'executive'
    LEFT JOIN assignment_evaluations ae_team
      ON ae_team.assignment_id = tro.assignment_id
      AND ae_team.evaluator_type = 'team'
    LEFT JOIN assignment_evaluations ae_const
      ON ae_const.assignment_id = tro.assignment_id
      AND ae_const.evaluator_type = 'constitutional'
    LEFT JOIN assignment_evaluations ae_cos
      ON ae_cos.assignment_id = tro.assignment_id
      AND ae_cos.evaluator_type = 'cos'
    WHERE ca.status = 'active'
    GROUP BY ca.role
  ),
  penalties AS (
    SELECT
      agent_id,
      -- P0 unresolved: -0.15 each, capped at -0.30
      LEAST(COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) * 0.15, 0.30)
      -- P1 unresolved: -0.05 each, capped at -0.10
      + LEAST(COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) * 0.05, 0.10)
      AS penalty_sum
    FROM fleet_findings
    GROUP BY agent_id
  ),
  weighted AS (
    SELECT
      s.agent_id,
      CASE
        -- No exec AND no team quality data: redistribute to success/constitutional/cos
        WHEN s.exec_quality IS NULL AND s.team_quality IS NULL AND s.success_rate IS NOT NULL THEN
          (s.success_rate * 0.55)
          + (COALESCE(s.constitutional_score, 0.7) * 0.28)
          + (COALESCE(s.cos_quality, 0.5) * 0.17)

        -- Only team quality available (no exec)
        WHEN s.exec_quality IS NULL AND s.team_quality IS NOT NULL THEN
          (s.team_quality * 0.40)
          + (COALESCE(s.success_rate, 0.5) * 0.30)
          + (COALESCE(s.constitutional_score, 0.7) * 0.20)
          + (COALESCE(s.cos_quality, 0.5) * 0.10)

        -- Only exec quality available (no team)
        WHEN s.exec_quality IS NOT NULL AND s.team_quality IS NULL THEN
          (s.exec_quality * 0.40)
          + (COALESCE(s.success_rate, 0.5) * 0.30)
          + (COALESCE(s.constitutional_score, 0.7) * 0.20)
          + (COALESCE(s.cos_quality, 0.5) * 0.10)

        -- Both exec and team available: standard formula
        WHEN s.exec_quality IS NOT NULL AND s.team_quality IS NOT NULL THEN
          (((s.exec_quality + s.team_quality) / 2) * 0.40)
          + (COALESCE(s.success_rate, 0.5) * 0.25)
          + (COALESCE(s.constitutional_score, 0.7) * 0.20)
          + (COALESCE(s.cos_quality, 0.5) * 0.15)

        -- No data at all (no runs in window): NULL
        ELSE NULL
      END AS raw_score
    FROM agent_scores s
  )
  UPDATE company_agents
  SET performance_score = CASE
        WHEN w.raw_score IS NOT NULL THEN
          GREATEST(0, ROUND(w.raw_score - COALESCE(p.penalty_sum, 0), 2))
        ELSE NULL
      END,
      updated_at = NOW()
  FROM weighted w
  LEFT JOIN penalties p ON p.agent_id = w.agent_id
  WHERE company_agents.role = w.agent_id
  RETURNING company_agents.role AS agent_role, company_agents.performance_score AS new_score;
END;
$$ LANGUAGE plpgsql;
