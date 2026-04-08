BEGIN;

-- normalize_design_brief is required by advanced-web-creation / web pipeline skills and
-- system prompts, but was missing from agent_tool_grants while allowlist mode was active.
-- Without this row, ToolExecutor returns "not granted" even when the tool exists in code.

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'normalize_design_brief', 'system', 'VP Design: design brief normalization before invoke_web_build / pipeline steps.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'ui-ux-designer', 'normalize_design_brief', 'system', 'UI/UX: shared web-creation workflow with normalized brief.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'normalize_design_brief', 'system', 'Frontend: system prompt directs normalize_design_brief + invoke_web_build.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
