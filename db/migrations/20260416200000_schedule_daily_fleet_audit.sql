-- Schedule daily fleet governance audit via platform-intel agent
-- Runs at 06:00 UTC (midnight CT) daily
INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled, payload)
VALUES ('platform-intel', '0 6 * * *', 'fleet_audit', true, '{}')
ON CONFLICT DO NOTHING;
