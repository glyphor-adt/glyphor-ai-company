-- Design Team Tool Grants
-- Seeds baseline grants for the 60+ new design team tools across all 5 design agents.
-- Tool files: frontendCodeTools, screenshotTools, designSystemTools, auditTools,
--   assetTools, scaffoldTools, deployPreviewTools, figmaTools, storybookTools

-- ── Mia Tanaka (VP Design) — All tools ──
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- frontendCodeTools (all 7)
  ('vp-design', 'read_frontend_file', 'system'),
  ('vp-design', 'search_frontend_code', 'system'),
  ('vp-design', 'list_frontend_files', 'system'),
  ('vp-design', 'write_frontend_file', 'system'),
  ('vp-design', 'create_design_branch', 'system'),
  ('vp-design', 'create_frontend_pr', 'system'),
  ('vp-design', 'check_pr_status', 'system'),
  -- screenshotTools (all 4)
  ('vp-design', 'screenshot_page', 'system'),
  ('vp-design', 'screenshot_component', 'system'),
  ('vp-design', 'compare_screenshots', 'system'),
  ('vp-design', 'check_responsive', 'system'),
  -- designSystemTools (all 7)
  ('vp-design', 'update_design_token', 'system'),
  ('vp-design', 'validate_tokens_vs_implementation', 'system'),
  ('vp-design', 'get_color_palette', 'system'),
  ('vp-design', 'get_typography_scale', 'system'),
  ('vp-design', 'list_components', 'system'),
  ('vp-design', 'get_component_usage', 'system'),
  -- auditTools (all 6)
  ('vp-design', 'run_lighthouse_audit', 'system'),
  ('vp-design', 'run_accessibility_audit', 'system'),
  ('vp-design', 'check_ai_smell', 'system'),
  ('vp-design', 'validate_brand_compliance', 'system'),
  ('vp-design', 'check_bundle_size', 'system'),
  ('vp-design', 'check_build_errors', 'system'),
  -- assetTools (all 5)
  ('vp-design', 'generate_image', 'system'),
  ('vp-design', 'upload_asset', 'system'),
  ('vp-design', 'list_assets', 'system'),
  ('vp-design', 'optimize_image', 'system'),
  ('vp-design', 'generate_favicon_set', 'system'),
  -- scaffoldTools (all 4)
  ('vp-design', 'scaffold_component', 'system'),
  ('vp-design', 'scaffold_page', 'system'),
  ('vp-design', 'list_templates', 'system'),
  ('vp-design', 'clone_and_modify', 'system'),
  -- deployPreviewTools (all 3)
  ('vp-design', 'deploy_preview', 'system'),
  ('vp-design', 'get_deployment_status', 'system'),
  ('vp-design', 'list_deployments', 'system'),
  -- figmaTools (all 17)
  ('vp-design', 'get_figma_file', 'system'),
  ('vp-design', 'export_figma_images', 'system'),
  ('vp-design', 'get_figma_image_fills', 'system'),
  ('vp-design', 'get_figma_components', 'system'),
  ('vp-design', 'get_figma_team_components', 'system'),
  ('vp-design', 'get_figma_styles', 'system'),
  ('vp-design', 'get_figma_team_styles', 'system'),
  ('vp-design', 'get_figma_comments', 'system'),
  ('vp-design', 'post_figma_comment', 'system'),
  ('vp-design', 'resolve_figma_comment', 'system'),
  ('vp-design', 'get_figma_file_metadata', 'system'),
  ('vp-design', 'get_figma_version_history', 'system'),
  ('vp-design', 'get_figma_team_projects', 'system'),
  ('vp-design', 'get_figma_project_files', 'system'),
  ('vp-design', 'get_figma_dev_resources', 'system'),
  ('vp-design', 'create_figma_dev_resource', 'system'),
  ('vp-design', 'manage_figma_webhooks', 'system'),
  -- storybookTools (all 7)
  ('vp-design', 'storybook_list_stories', 'system'),
  ('vp-design', 'storybook_screenshot', 'system'),
  ('vp-design', 'storybook_screenshot_all', 'system'),
  ('vp-design', 'storybook_visual_diff', 'system'),
  ('vp-design', 'storybook_save_baseline', 'system'),
  ('vp-design', 'storybook_check_coverage', 'system'),
  ('vp-design', 'storybook_get_story_source', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ── Leo Vargas (UI/UX Designer) — code, screenshots, design system, assets, Figma ──
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- frontendCodeTools (read-only)
  ('ui-ux-designer', 'read_frontend_file', 'system'),
  ('ui-ux-designer', 'search_frontend_code', 'system'),
  ('ui-ux-designer', 'list_frontend_files', 'system'),
  ('ui-ux-designer', 'check_pr_status', 'system'),
  -- screenshotTools (all 4)
  ('ui-ux-designer', 'screenshot_page', 'system'),
  ('ui-ux-designer', 'screenshot_component', 'system'),
  ('ui-ux-designer', 'compare_screenshots', 'system'),
  ('ui-ux-designer', 'check_responsive', 'system'),
  -- designSystemTools (read-only)
  ('ui-ux-designer', 'get_color_palette', 'system'),
  ('ui-ux-designer', 'get_typography_scale', 'system'),
  ('ui-ux-designer', 'list_components', 'system'),
  ('ui-ux-designer', 'get_component_usage', 'system'),
  -- assetTools (create + list)
  ('ui-ux-designer', 'generate_image', 'system'),
  ('ui-ux-designer', 'upload_asset', 'system'),
  ('ui-ux-designer', 'list_assets', 'system'),
  -- figmaTools (read + comments)
  ('ui-ux-designer', 'get_figma_file', 'system'),
  ('ui-ux-designer', 'export_figma_images', 'system'),
  ('ui-ux-designer', 'get_figma_image_fills', 'system'),
  ('ui-ux-designer', 'get_figma_components', 'system'),
  ('ui-ux-designer', 'get_figma_styles', 'system'),
  ('ui-ux-designer', 'get_figma_comments', 'system'),
  ('ui-ux-designer', 'get_figma_file_metadata', 'system'),
  ('ui-ux-designer', 'get_figma_version_history', 'system'),
  ('ui-ux-designer', 'get_figma_dev_resources', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ── Ava Chen (Frontend Engineer) — code, screenshots, audits, scaffold, deploy, Storybook ──
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- frontendCodeTools (read + write)
  ('frontend-engineer', 'read_frontend_file', 'system'),
  ('frontend-engineer', 'search_frontend_code', 'system'),
  ('frontend-engineer', 'list_frontend_files', 'system'),
  ('frontend-engineer', 'write_frontend_file', 'system'),
  ('frontend-engineer', 'check_pr_status', 'system'),
  -- screenshotTools (page + responsive)
  ('frontend-engineer', 'screenshot_page', 'system'),
  ('frontend-engineer', 'check_responsive', 'system'),
  -- auditTools (all 6)
  ('frontend-engineer', 'run_lighthouse_audit', 'system'),
  ('frontend-engineer', 'run_accessibility_audit', 'system'),
  ('frontend-engineer', 'check_ai_smell', 'system'),
  ('frontend-engineer', 'validate_brand_compliance', 'system'),
  ('frontend-engineer', 'check_bundle_size', 'system'),
  ('frontend-engineer', 'check_build_errors', 'system'),
  -- scaffoldTools (component only)
  ('frontend-engineer', 'scaffold_component', 'system'),
  ('frontend-engineer', 'list_templates', 'system'),
  -- deployPreviewTools (status + list)
  ('frontend-engineer', 'get_deployment_status', 'system'),
  ('frontend-engineer', 'list_deployments', 'system'),
  -- storybookTools (all 7)
  ('frontend-engineer', 'storybook_list_stories', 'system'),
  ('frontend-engineer', 'storybook_screenshot', 'system'),
  ('frontend-engineer', 'storybook_screenshot_all', 'system'),
  ('frontend-engineer', 'storybook_visual_diff', 'system'),
  ('frontend-engineer', 'storybook_save_baseline', 'system'),
  ('frontend-engineer', 'storybook_check_coverage', 'system'),
  ('frontend-engineer', 'storybook_get_story_source', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ── Sofia Marchetti (Design Critic) — code, screenshots, design system, audits, Figma, Storybook ──
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- frontendCodeTools (read-only)
  ('design-critic', 'read_frontend_file', 'system'),
  ('design-critic', 'search_frontend_code', 'system'),
  ('design-critic', 'list_frontend_files', 'system'),
  ('design-critic', 'check_pr_status', 'system'),
  -- screenshotTools (all 4)
  ('design-critic', 'screenshot_page', 'system'),
  ('design-critic', 'screenshot_component', 'system'),
  ('design-critic', 'compare_screenshots', 'system'),
  ('design-critic', 'check_responsive', 'system'),
  -- designSystemTools (read + validate)
  ('design-critic', 'validate_tokens_vs_implementation', 'system'),
  ('design-critic', 'get_color_palette', 'system'),
  ('design-critic', 'get_typography_scale', 'system'),
  ('design-critic', 'list_components', 'system'),
  ('design-critic', 'get_component_usage', 'system'),
  -- auditTools (all 6)
  ('design-critic', 'run_lighthouse_audit', 'system'),
  ('design-critic', 'run_accessibility_audit', 'system'),
  ('design-critic', 'check_ai_smell', 'system'),
  ('design-critic', 'validate_brand_compliance', 'system'),
  ('design-critic', 'check_bundle_size', 'system'),
  ('design-critic', 'check_build_errors', 'system'),
  -- figmaTools (read + comments)
  ('design-critic', 'get_figma_file', 'system'),
  ('design-critic', 'export_figma_images', 'system'),
  ('design-critic', 'get_figma_components', 'system'),
  ('design-critic', 'get_figma_styles', 'system'),
  ('design-critic', 'get_figma_comments', 'system'),
  ('design-critic', 'post_figma_comment', 'system'),
  ('design-critic', 'get_figma_file_metadata', 'system'),
  ('design-critic', 'get_figma_version_history', 'system'),
  ('design-critic', 'get_figma_dev_resources', 'system'),
  -- storybookTools (all 7)
  ('design-critic', 'storybook_list_stories', 'system'),
  ('design-critic', 'storybook_screenshot', 'system'),
  ('design-critic', 'storybook_screenshot_all', 'system'),
  ('design-critic', 'storybook_visual_diff', 'system'),
  ('design-critic', 'storybook_save_baseline', 'system'),
  ('design-critic', 'storybook_check_coverage', 'system'),
  ('design-critic', 'storybook_get_story_source', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- ── Ryan Park (Template Architect) — code, design system, assets, scaffold, Figma, Storybook ──
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- frontendCodeTools (read + write)
  ('template-architect', 'read_frontend_file', 'system'),
  ('template-architect', 'search_frontend_code', 'system'),
  ('template-architect', 'list_frontend_files', 'system'),
  ('template-architect', 'write_frontend_file', 'system'),
  ('template-architect', 'check_pr_status', 'system'),
  -- designSystemTools (read + update)
  ('template-architect', 'update_design_token', 'system'),
  ('template-architect', 'validate_tokens_vs_implementation', 'system'),
  ('template-architect', 'get_color_palette', 'system'),
  ('template-architect', 'get_typography_scale', 'system'),
  ('template-architect', 'list_components', 'system'),
  ('template-architect', 'get_component_usage', 'system'),
  -- assetTools (create + optimize)
  ('template-architect', 'generate_image', 'system'),
  ('template-architect', 'upload_asset', 'system'),
  ('template-architect', 'list_assets', 'system'),
  ('template-architect', 'optimize_image', 'system'),
  ('template-architect', 'generate_favicon_set', 'system'),
  -- scaffoldTools (all 4)
  ('template-architect', 'scaffold_component', 'system'),
  ('template-architect', 'scaffold_page', 'system'),
  ('template-architect', 'list_templates', 'system'),
  ('template-architect', 'clone_and_modify', 'system'),
  -- figmaTools (read + dev resources)
  ('template-architect', 'get_figma_file', 'system'),
  ('template-architect', 'export_figma_images', 'system'),
  ('template-architect', 'get_figma_image_fills', 'system'),
  ('template-architect', 'get_figma_components', 'system'),
  ('template-architect', 'get_figma_styles', 'system'),
  ('template-architect', 'get_figma_comments', 'system'),
  ('template-architect', 'get_figma_file_metadata', 'system'),
  ('template-architect', 'get_figma_version_history', 'system'),
  ('template-architect', 'get_figma_dev_resources', 'system'),
  ('template-architect', 'create_figma_dev_resource', 'system'),
  -- storybookTools (all 7)
  ('template-architect', 'storybook_list_stories', 'system'),
  ('template-architect', 'storybook_screenshot', 'system'),
  ('template-architect', 'storybook_screenshot_all', 'system'),
  ('template-architect', 'storybook_visual_diff', 'system'),
  ('template-architect', 'storybook_save_baseline', 'system'),
  ('template-architect', 'storybook_check_coverage', 'system'),
  ('template-architect', 'storybook_get_story_source', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
