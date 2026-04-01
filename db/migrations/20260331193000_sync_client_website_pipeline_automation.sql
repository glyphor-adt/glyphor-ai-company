BEGIN;

INSERT INTO tool_registry (name, description, category, parameters, created_by, approved_by, is_active, tags)
VALUES
  (
    'github_get_pull_request_status',
    'Get merge readiness and CI/check status for a client repository pull request in owner/name format.',
    'engineering',
    '{"repo":{"type":"string","required":true},"pr_number":{"type":"number","required":true}}'::jsonb,
    'system',
    'system',
    true,
    ARRAY['github', 'website', 'deployment', 'ci']::text[]
  ),
  (
    'github_wait_for_pull_request_checks',
    'Poll a client repository pull request until checks succeed, fail, or timeout.',
    'engineering',
    '{"repo":{"type":"string","required":true},"pr_number":{"type":"number","required":true},"timeout_seconds":{"type":"number","required":false},"poll_interval_seconds":{"type":"number","required":false}}'::jsonb,
    'system',
    'system',
    true,
    ARRAY['github', 'website', 'deployment', 'ci']::text[]
  ),
  (
    'vercel_get_production_url',
    'Get the latest production deployment URL for a Vercel project and report readiness.',
    'engineering',
    '{"project_id":{"type":"string","required":false},"project_name":{"type":"string","required":true}}'::jsonb,
    'system',
    'system',
    true,
    ARRAY['vercel', 'website', 'deployment', 'production']::text[]
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  parameters = EXCLUDED.parameters,
  approved_by = EXCLUDED.approved_by,
  is_active = EXCLUDED.is_active,
  tags = EXCLUDED.tags,
  updated_at = NOW();

UPDATE skills
SET description = 'Execute Glyphor''s end-to-end client website pipeline — from normalized brief to quality-gated deployed site. Includes preview generation, PR promotion, CI gating, merge, and production verification for client repositories.',
    tools_granted = ARRAY[
      'normalize_design_brief',
      'github_create_from_template',
      'vercel_create_project',
      'vercel_get_preview_url',
      'vercel_get_production_url',
      'cloudflare_register_preview',
      'cloudflare_update_preview',
      'search_components',
      'get_component_info',
      'get_installation_info',
      'install_item_from_registry',
      'build_website_foundation',
      'github_push_files',
      'github_create_pull_request',
      'github_get_pull_request_status',
      'github_wait_for_pull_request_checks',
      'github_merge_pull_request',
      'deploy_preview',
      'screenshot_page',
      'check_ai_smell',
      'run_accessibility_audit',
      'run_lighthouse_audit',
      'save_memory',
      'send_agent_message'
    ]::text[],
    updated_at = NOW()
WHERE slug = 'client-web-creation';

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_get_pull_request_status', 'system', 'Client website pipeline PR orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_wait_for_pull_request_checks', 'system', 'Client website pipeline PR orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'vercel_get_production_url', 'system', 'Client website pipeline production verification.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'github_get_pull_request_status', 'system', 'Client website implementation CI checks.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'vercel_get_production_url', 'system', 'Client website production verification.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'github_get_pull_request_status', 'system', 'Client website deployment CI checks.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'github_wait_for_pull_request_checks', 'system', 'Client website deployment CI checks.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'vercel_get_production_url', 'system', 'Client website production verification.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'design-critic', 'vercel_get_production_url', 'system', 'Review access to production deployment URLs.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;