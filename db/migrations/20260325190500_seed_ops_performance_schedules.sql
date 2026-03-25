-- Ensure Ops has performance pipeline schedules in dynamic scheduler table.
-- These tasks power agent_performance rollups, milestone detection, and growth updates.

INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled)
SELECT 'ops', '15 6 * * *', 'performance_rollup', true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules
  WHERE agent_id = 'ops' AND task = 'performance_rollup' AND cron_expression = '15 6 * * *' AND enabled = true
);

INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled)
SELECT 'ops', '30 6 * * *', 'milestone_detection', true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules
  WHERE agent_id = 'ops' AND task = 'milestone_detection' AND cron_expression = '30 6 * * *' AND enabled = true
);

INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled)
SELECT 'ops', '45 6 * * 1', 'growth_update', true
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules
  WHERE agent_id = 'ops' AND task = 'growth_update' AND cron_expression = '45 6 * * 1' AND enabled = true
);
