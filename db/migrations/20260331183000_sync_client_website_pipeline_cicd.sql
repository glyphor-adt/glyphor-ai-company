BEGIN;

INSERT INTO tool_registry (name, description, category, parameters, created_by, approved_by, is_active, tags)
VALUES
  (
    'github_create_pull_request',
    'Open a pull request for a client repository in owner/name format to promote a website build to main.',
    'engineering',
    '{"repo":{"type":"string","required":true},"head_branch":{"type":"string","required":true},"base_branch":{"type":"string","required":false},"title":{"type":"string","required":true},"body":{"type":"string","required":false},"draft":{"type":"boolean","required":false}}'::jsonb,
    'system',
    'system',
    true,
    ARRAY['github', 'website', 'deployment', 'pr']::text[]
  ),
  (
    'github_merge_pull_request',
    'Merge a pull request for a client repository in owner/name format after checks pass.',
    'engineering',
    '{"repo":{"type":"string","required":true},"pr_number":{"type":"number","required":true},"merge_method":{"type":"string","required":false},"commit_title":{"type":"string","required":false},"commit_message":{"type":"string","required":false}}'::jsonb,
    'system',
    'system',
    true,
    ARRAY['github', 'website', 'deployment', 'merge']::text[]
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
SET description = 'Execute Glyphor''s end-to-end client website pipeline — from normalized brief to quality-gated deployed site. Includes preview generation, PR promotion, and main-branch ship flow for client repositories.',
    tools_granted = ARRAY[
      'normalize_design_brief',
      'github_create_from_template',
      'vercel_create_project',
      'vercel_get_preview_url',
      'cloudflare_register_preview',
      'cloudflare_update_preview',
      'search_components',
      'get_component_info',
      'get_installation_info',
      'install_item_from_registry',
      'build_website_foundation',
      'github_push_files',
      'github_create_pull_request',
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
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_create_pull_request', 'system', 'Client website pipeline promotion orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_merge_pull_request', 'system', 'Client website pipeline promotion orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'github_create_pull_request', 'system', 'Client website implementation promotion.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'github_merge_pull_request', 'system', 'Client website deployment promotion.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;