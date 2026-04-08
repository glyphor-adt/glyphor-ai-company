BEGIN;

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'plan_website_build', 'system', 'VP Design website planning workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'invoke_web_build', 'system', 'VP Design website build workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'invoke_web_iterate', 'system', 'VP Design website iteration workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'invoke_web_coding_loop', 'system', 'VP Design autonomous web remediation workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'get_file_contents', 'system', 'VP Design GitHub code review workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'list_open_prs', 'system', 'VP Design GitHub code review workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'comment_on_pr', 'system', 'VP Design GitHub code review workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'create_design_issue', 'system', 'VP Design GitHub code review workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_create_from_template', 'system', 'VP Design GitHub website creation workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_push_files', 'system', 'VP Design GitHub website creation workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_create_pull_request', 'system', 'VP Design GitHub promotion workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_get_pull_request_status', 'system', 'VP Design GitHub promotion workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_wait_for_pull_request_checks', 'system', 'VP Design GitHub promotion workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'github_merge_pull_request', 'system', 'VP Design GitHub promotion workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'vercel_create_project', 'system', 'VP Design Vercel provisioning workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'vercel_get_preview_url', 'system', 'VP Design Vercel preview workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'vercel_wait_for_preview_ready', 'system', 'VP Design Vercel deploy verification workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'vercel_get_production_url', 'system', 'VP Design Vercel production verification workflow.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'vp-design', 'vercel_get_deployment_logs', 'system', 'VP Design Vercel diagnostics workflow.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

COMMIT;
