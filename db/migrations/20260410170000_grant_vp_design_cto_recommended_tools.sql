BEGIN;

-- Clear company-health recommended gaps: tool discovery, a11y/quality, inbox/branch for VP Design;
-- design-brief + web-build hooks for CTO (engineering can steer / unblock web pipeline).

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'list_my_tools', 'system', 'Recommended: discover granted tools', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'tool_search', 'system', 'Recommended: find tools by capability', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'run_accessibility_audit', 'system', 'Recommended: a11y on previews', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'check_ai_smell', 'system', 'Recommended: quality heuristics', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'read_inbox', 'system', 'Recommended: founder/email context', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'create_git_branch', 'system', 'Recommended: branch before PR', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'cto', 'normalize_design_brief', 'system', 'Recommended: unblock / review design brief handoff', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'cto', 'invoke_web_build', 'system', 'Recommended: engineering can trigger web builds when needed', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
