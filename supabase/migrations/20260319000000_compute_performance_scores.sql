-- Compute composite performance_score for each active agent from trailing 30-day data.
-- Score = weighted blend of success rate, reflection quality, and assignment quality (0.00–1.00).
-- Weights redistribute when a component has no data.

CREATE OR REPLACE FUNCTION compute_performance_scores()
RETURNS TABLE(agent_role TEXT, new_score NUMERIC) AS $$
DECLARE
  w_success NUMERIC := 0.40;
  w_reflect NUMERIC := 0.30;
  w_assign  NUMERIC := 0.30;
  cutoff    TIMESTAMPTZ := NOW() - INTERVAL '30 days';
  agent     RECORD;
  success_rate  NUMERIC;
  reflect_avg   NUMERIC;
  assign_avg    NUMERIC;
  total_weight  NUMERIC;
  score         NUMERIC;
BEGIN
  FOR agent IN
    SELECT role FROM company_agents WHERE status = 'active'
  LOOP
    -- 1. Success rate from agent_performance daily rollups
    SELECT
      CASE WHEN COALESCE(SUM(total_runs), 0) = 0 THEN NULL
           ELSE SUM(successful_runs)::NUMERIC / SUM(total_runs)::NUMERIC
      END
    INTO success_rate
    FROM agent_performance
    WHERE agent_id = agent.role AND date >= cutoff::DATE;

    -- 2. Average self-assessed quality from reflections (0–100 → 0–1)
    SELECT AVG(quality_score) / 100.0
    INTO reflect_avg
    FROM agent_reflections
    WHERE agent_role = agent.role AND created_at >= cutoff;

    -- 3. Average assignment quality from CoS evaluations (0–100 → 0–1)
    SELECT AVG(quality_score) / 100.0
    INTO assign_avg
    FROM work_assignments
    WHERE assigned_to = agent.role
      AND quality_score IS NOT NULL
      AND updated_at >= cutoff;

    -- Compute weighted score, redistributing weights for missing components
    total_weight := 0;
    score := 0;

    IF success_rate IS NOT NULL THEN
      total_weight := total_weight + w_success;
      score := score + w_success * success_rate;
    END IF;

    IF reflect_avg IS NOT NULL THEN
      total_weight := total_weight + w_reflect;
      score := score + w_reflect * reflect_avg;
    END IF;

    IF assign_avg IS NOT NULL THEN
      total_weight := total_weight + w_assign;
      score := score + w_assign * assign_avg;
    END IF;

    IF total_weight > 0 THEN
      score := ROUND(score / total_weight, 2);
    ELSE
      score := NULL;
    END IF;

    -- Write back
    UPDATE company_agents
    SET performance_score = score
    WHERE role = agent.role;

    agent_role := agent.role;
    new_score  := score;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
