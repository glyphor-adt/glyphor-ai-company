BEGIN;

-- invoke_web_build / iterate / coding_loop call build_website_foundation via
-- ToolContext.executeChildTool → ToolExecutor.execute, which enforces per-tool
-- agent_tool_grants. vp-design had invoke_web_build but not this child — Mia saw
-- "not granted" for build_website_foundation. cto received invoke_web_build in
-- 20260410170000 with the same gap.

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'build_website_foundation', 'system', 'Child of invoke_web_iterate / invoke_web_build / coding_loop — code generation step.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'cto', 'build_website_foundation', 'system', 'Child of invoke_web_build when CTO triggers the website pipeline.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
