-- Seed weekly and monthly review schedules for the Chief of Staff.
-- These tasks are already implemented in the CoS runner but had no cron triggers.

INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled, payload)
VALUES
  -- Weekly collective intelligence review: Fridays at 4:00 PM CT (22:00 UTC)
  ('chief-of-staff', '0 22 * * 5', 'weekly_review', true, '{}'),
  -- Monthly retrospective: 1st of each month at 3:00 PM CT (21:00 UTC)
  ('chief-of-staff', '0 21 1 * *', 'monthly_retrospective', true, '{}')
ON CONFLICT DO NOTHING;
