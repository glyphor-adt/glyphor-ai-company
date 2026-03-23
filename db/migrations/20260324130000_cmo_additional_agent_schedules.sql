-- Additional DynamicScheduler rows for CMO (GTM orchestration cadence).
-- Idempotent: skip if same agent_id + cron_expression + task already exists.

INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
SELECT 'cmo', '*/30 * * * *', true, 'process_assignments',
  '{"context": "check_and_execute_pending_assignments"}'::jsonb,
  '00000000-0000-0000-0000-000000000000'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules s
  WHERE s.agent_id = 'cmo' AND s.cron_expression = '*/30 * * * *' AND s.task = 'process_assignments'
);

INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
SELECT 'cmo', '0 14 * * *', true, 'work_loop',
  '{"context": "morning_planning"}'::jsonb,
  '00000000-0000-0000-0000-000000000000'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules s
  WHERE s.agent_id = 'cmo' AND s.cron_expression = '0 14 * * *' AND s.task = 'work_loop'
);

INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
SELECT 'cmo', '0 18 * * *', true, 'work_loop',
  '{"context": "midday_review"}'::jsonb,
  '00000000-0000-0000-0000-000000000000'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM agent_schedules s
  WHERE s.agent_id = 'cmo' AND s.cron_expression = '0 18 * * *' AND s.task = 'work_loop'
);
