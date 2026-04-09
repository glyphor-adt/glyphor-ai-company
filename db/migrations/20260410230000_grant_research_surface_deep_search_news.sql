BEGIN;

-- VP Research tool bundle in code includes deep_research + search_news + submit_research_packet,
-- but baseline grants (20260410160000) only had web_search/web_fetch. With allowlist execution
-- policy, undeclared tools are invisible / denied — agents report "disabled" tools.

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'deep_research', 'system', 'Research: composite sweep', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'search_news', 'system', 'Research: news sweep', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-research', 'submit_research_packet', 'system', 'Research: packet handoff', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'competitive-research-analyst', 'deep_research', 'system', 'Research: composite sweep', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'competitive-research-analyst', 'search_news', 'system', 'Research: news sweep', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'market-research-analyst', 'deep_research', 'system', 'Research: composite sweep', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'market-research-analyst', 'search_news', 'system', 'Research: news sweep', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
