-- Migration: tool_access_fixes
-- Purpose: Fix zero-grant agents and clean up stale expired grants
-- Related: Layer 18 smoketest T18.8 (zero-grant agents) and T18.9 (expired grants)

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Grant baseline shared tools to agents that currently have zero grants.
--    logo-production-specialist and briefing-coordinator are active in
--    company_agents but have no entries in agent_tool_grants.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, is_active)
SELECT role, tool, 'migration', true
FROM (
  VALUES
    ('logo-production-specialist', 'save_memory'),
    ('logo-production-specialist', 'recall_memories'),
    ('logo-production-specialist', 'read_my_assignments'),
    ('logo-production-specialist', 'submit_assignment_output'),
    ('logo-production-specialist', 'flag_assignment_blocker'),
    ('logo-production-specialist', 'send_agent_message'),
    ('logo-production-specialist', 'check_messages'),
    ('logo-production-specialist', 'call_meeting'),
    ('logo-production-specialist', 'emit_insight'),
    ('logo-production-specialist', 'emit_alert'),
    ('logo-production-specialist', 'request_new_tool'),
    ('logo-production-specialist', 'generate_image'),
    ('logo-production-specialist', 'log_activity'),

    ('briefing-coordinator', 'save_memory'),
    ('briefing-coordinator', 'recall_memories'),
    ('briefing-coordinator', 'read_my_assignments'),
    ('briefing-coordinator', 'submit_assignment_output'),
    ('briefing-coordinator', 'flag_assignment_blocker'),
    ('briefing-coordinator', 'send_agent_message'),
    ('briefing-coordinator', 'check_messages'),
    ('briefing-coordinator', 'call_meeting'),
    ('briefing-coordinator', 'emit_insight'),
    ('briefing-coordinator', 'emit_alert'),
    ('briefing-coordinator', 'request_new_tool'),
    ('briefing-coordinator', 'send_email'),
    ('briefing-coordinator', 'read_inbox'),
    ('briefing-coordinator', 'log_activity')
) AS t(role, tool)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Deactivate stale expired grants.
--    Grants with expires_at in the past should not remain is_active = true.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE agent_tool_grants
SET is_active = false
WHERE is_active = true
  AND expires_at IS NOT NULL
  AND expires_at < NOW();

COMMIT;
