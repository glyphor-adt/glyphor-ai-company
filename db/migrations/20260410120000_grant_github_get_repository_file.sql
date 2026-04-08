BEGIN;

-- Read client repo files (Glyphor-Fuse/*) via GitHub API with pipeline credentials.
-- vp-design does not have web_fetch; Mia was incorrectly telling users "web_fetch revoked".

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_get_repository_file', 'system', 'Read package.json / config from client Fuse repos before push.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'github_get_repository_file', 'system', 'Client website debugging alongside github_push_files.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
