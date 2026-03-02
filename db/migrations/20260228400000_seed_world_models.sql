-- Seed baseline world models for all active agents.
-- Without this, the World Model tab in agent profiles shows "No world model data"
-- because updateFromGrade (the only writer) requires a completed evaluation cycle.

INSERT INTO agent_world_model (agent_role, strengths, weaknesses, task_type_scores, prediction_accuracy, improvement_goals, rubric_version)
SELECT
  ca.role,
  '[]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  0.5,
  '[]'::jsonb,
  1
FROM company_agents ca
WHERE ca.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM agent_world_model wm WHERE wm.agent_role = ca.role
  )
ON CONFLICT (agent_role) DO NOTHING;
