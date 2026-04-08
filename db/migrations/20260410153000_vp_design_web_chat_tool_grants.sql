BEGIN;

-- VP Design + Frontend: tools referenced in chat bundles / skills but missing from agent_tool_grants
-- under allowlist mode. Fixes Mia hitting "not granted" on web_fetch, quick_demo, directory lookup,
-- and invoke_web_* Cloudflare preview steps.

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'web_fetch', 'system', 'Chat core: public docs, raw GitHub URLs, Vercel/help pages.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'web_search', 'system', 'Design research and troubleshooting discoverability.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'quick_demo_web_app', 'system', 'Dashboard chat: quick inline demos per system prompt.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'get_agent_directory', 'system', 'Delegate web_fetch / specialist work to correct role.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'who_handles', 'system', 'Resolve which agent owns a capability (e.g. web_fetch).', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'cloudflare_register_preview', 'system', 'Website pipeline: preview URL registration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'cloudflare_update_preview', 'system', 'Website pipeline: preview URL updates on iterate.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'read_company_knowledge', 'system', 'Chat core: company knowledge sections (brand, competitive, etc.).', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'web_fetch', 'system', 'Chat core + client repo debugging.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'web_search', 'system', 'Implementation research.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'quick_demo_web_app', 'system', 'Inline demos alongside web build tools.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'get_agent_directory', 'system', 'Cross-agent handoff.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'who_handles', 'system', 'Capability routing.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'cloudflare_register_preview', 'system', 'Client website pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'cloudflare_update_preview', 'system', 'Client website pipeline.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;
