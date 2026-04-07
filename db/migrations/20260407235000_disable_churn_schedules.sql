-- Cadence reduction: disable high-churn scheduled runs identified in AGENT-CADENCE-AUDIT.md
--
-- Affected schedules (seeded by 20260227100030_seed_sub_team_schedules.sql):
--   cfo / daily_cost_check (afternoon 3 PM) — billing data doesn't refresh between morning and PM
--   ops / morning_status                    — covered by chief-of-staff morning_briefing
--   ops / evening_status                    — low-signal status theater; no downstream consumers confirmed
--
-- These rows were seeded into agent_schedules. Disabling here via UPDATE rather than DELETE
-- so they can be re-enabled easily if needed.

UPDATE agent_schedules
   SET enabled = false
 WHERE (agent_id = 'cfo'  AND task = 'daily_cost_check' AND cron_expression = '0 20 * * *')
    OR (agent_id = 'ops'  AND task = 'morning_status')
    OR (agent_id = 'ops'  AND task = 'evening_status');
