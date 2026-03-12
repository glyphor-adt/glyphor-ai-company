-- Backfill and reactivate baseline tool grants for roles flagged by smoketest
-- Layer 18. These rows existed historically, but some environments can drift if
-- grants were deactivated or partial seed state was applied before newer smoke
-- expectations were introduced.

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, is_active, expires_at)
VALUES
  ('vp-sales', 'save_memory', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'recall_memories', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'read_my_assignments', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'submit_assignment_output', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'flag_assignment_blocker', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'send_agent_message', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'check_messages', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'call_meeting', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'send_email', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'read_inbox', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'reply_to_email', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'create_decision', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('vp-sales', 'log_activity', 'system', 'restored baseline grant for smoketest coverage', true, NULL),

  ('user-researcher', 'save_memory', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'recall_memories', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'read_my_assignments', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'submit_assignment_output', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'flag_assignment_blocker', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'send_agent_message', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'check_messages', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'query_user_analytics', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'query_onboarding_funnel', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'design_experiment', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('user-researcher', 'log_activity', 'system', 'restored baseline grant for smoketest coverage', true, NULL),

  ('competitive-intel', 'save_memory', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'recall_memories', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'read_my_assignments', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'submit_assignment_output', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'flag_assignment_blocker', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'send_agent_message', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'check_messages', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'fetch_github_releases', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'search_hacker_news', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'store_intel', 'system', 'restored baseline grant for smoketest coverage', true, NULL),
  ('competitive-intel', 'log_activity', 'system', 'restored baseline grant for smoketest coverage', true, NULL)
ON CONFLICT (agent_role, tool_name) DO UPDATE
SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = true,
  expires_at = NULL,
  updated_at = NOW();
