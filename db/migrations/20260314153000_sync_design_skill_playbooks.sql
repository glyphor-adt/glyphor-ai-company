-- Sync Design team skill playbooks from markdown source files.
-- Sources:
--   skills/design/design-review.md
--   skills/design/design-system-management.md
--   skills/design/brand-management.md
--   skills/design/ui-development.md
--   skills/design/ux-design.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'design-review',
      'design-review',
      'design',
      'Evaluate the quality, consistency, accessibility, and human-craft feel of any visual output across components, pages, templates, and assets. Use when reviewing design work before shipping, auditing quality regressions, scoring against the Prism system, or detecting AI-smell patterns.',
      $design_review$
# Design Review

Run every review through five weighted dimensions:
1. Brand compliance
2. Craft quality
3. Accessibility
4. Performance
5. Consistency

Use screenshot diffs and audit tools to produce specific, actionable findings with a clear ship/no-ship score.

Always detect and reject AI-smell patterns: visual monotony, default SaaS aesthetics, weak hierarchy, and off-brand composition.
      $design_review$,
      ARRAY[
        'check_ai_smell',
        'run_accessibility_audit',
        'run_lighthouse_audit',
        'run_lighthouse_batch',
        'get_design_quality_summary',
        'screenshot_component',
        'screenshot_page',
        'compare_screenshots',
        'get_component_usage',
        'get_design_tokens',
        'get_color_palette',
        'get_typography_scale',
        'validate_tokens_vs_implementation',
        'validate_brand_compliance',
        'read_file',
        'get_file_contents',
        'save_memory',
        'send_agent_message'
      ]::text[],
      2
    ),
    (
      'design-system-management',
      'design-system-management',
      'design',
      'Maintain and evolve the Prism design system across tokens, components, templates, and implementation standards. Use when auditing token usage, resolving design-code drift, expanding component patterns, or enforcing design system consistency.',
      $design_system$
# Design System Management

Maintain Prism as a single source of truth across token definitions, component usage, template variants, and implementation code.

Core loop:
1. Audit drift between token definitions and real code.
2. Update tokens/components/templates with documentation.
3. Propagate updates to implementation.
4. Re-audit and publish migration guidance for any breaking changes.

Goal: eliminate design-code divergence and keep system updates predictable and scalable.
      $design_system$,
      ARRAY[
        'get_design_tokens',
        'update_design_token',
        'get_color_palette',
        'get_typography_scale',
        'get_component_library',
        'get_component_usage',
        'save_component_spec',
        'query_component_specs',
        'save_component_implementation',
        'query_component_implementations',
        'validate_tokens_vs_implementation',
        'get_template_registry',
        'list_templates',
        'save_template_variant',
        'update_template_status',
        'query_template_usage',
        'query_template_variants',
        'read_file',
        'get_file_contents',
        'create_or_update_file',
        'read_frontend_file',
        'write_frontend_file',
        'search_frontend_code',
        'save_memory',
        'send_agent_message'
      ]::text[],
      2
    ),
    (
      'brand-management',
      'brand-management',
      'design',
      'Own and enforce Glyphor visual identity across product, marketing, and exported assets. Use when creating or updating brand guidelines, generating logo/icon assets, auditing brand compliance, or evolving Prism standards.',
      $brand_management$
# Brand Management

Guard the Prism identity across all surfaces and assets.

Own:
1. Token-level brand consistency.
2. Logo/icon/avatar asset correctness.
3. Cross-surface brand compliance.
4. Controlled brand evolution with explicit rationale and rollout.

Every brand decision must preserve recognizability, consistency, and production readiness.
      $brand_management$,
      ARRAY[
        'validate_brand_compliance',
        'get_design_tokens',
        'update_design_token',
        'get_color_palette',
        'get_typography_scale',
        'create_logo_variation',
        'restyle_logo',
        'generate_favicon_set',
        'create_social_avatar',
        'get_figma_file',
        'get_figma_styles',
        'get_figma_team_styles',
        'export_figma_images',
        'generate_image',
        'optimize_image',
        'upload_asset',
        'list_assets',
        'read_file',
        'create_or_update_file',
        'get_file_contents',
        'web_search',
        'save_memory',
        'send_agent_message',
        'file_decision',
        'pulse_generate_concept_image',
        'pulse_edit_image',
        'pulse_remove_background',
        'pulse_upscale_image',
        'pulse_analyze_brand_website'
      ]::text[],
      2
    ),
    (
      'ui-development',
      'ui-development',
      'design',
      'Translate design decisions into production UI updates in code. Use when tokens, component styles, or Figma-to-frontend implementations need direct execution and shipping by design leadership.',
      $ui_development$
# UI Development

Bridge design intent to shipped implementation.

Execution loop:
1. Inspect existing frontend and design-token state.
2. Apply token and style updates in source code.
3. Verify drift and visual correctness.
4. Create branch/PR and ship via preview.

Use this skill for direct design-system-in-code changes, not broad application logic rewrites.
      $ui_development$,
      ARRAY[
        'get_design_tokens',
        'update_design_token',
        'get_component_library',
        'get_component_usage',
        'validate_tokens_vs_implementation',
        'read_frontend_file',
        'write_frontend_file',
        'search_frontend_code',
        'list_frontend_files',
        'read_file',
        'create_or_update_file',
        'get_file_contents',
        'get_figma_file',
        'get_figma_components',
        'get_figma_styles',
        'get_figma_team_components',
        'get_figma_team_styles',
        'export_figma_images',
        'create_figma_dev_resource',
        'post_figma_comment',
        'create_branch',
        'create_github_pr',
        'deploy_preview',
        'generate_image',
        'optimize_image',
        'generate_favicon_set',
        'create_logo_variation',
        'upload_asset',
        'save_memory',
        'send_agent_message',
        'file_decision',
        'pulse_generate_concept_image',
        'pulse_edit_image',
        'pulse_remove_background',
        'pulse_upscale_image',
        'pulse_expand_image',
        'pulse_doodle_to_image'
      ]::text[],
      2
    ),
    (
      'ux-design',
      'ux-design',
      'design',
      'Design user journeys, interaction patterns, and component specifications for the AI Cockpit. Use when new features need UX framing, friction points need remediation, onboarding funnels need optimization, or experiments need UX design support.',
      $ux_design$
# UX Design

Design for operator cognition in an AI-company cockpit context.

Core principles:
1. Progressive disclosure of complexity.
2. Three-second status comprehension.
3. Low cognitive load and high action clarity.

Deliver personas, flows, and implementable component specs tied to measurable funnel and activation outcomes.
      $ux_design$,
      ARRAY[
        'create_user_persona',
        'get_user_feedback',
        'query_user_analytics',
        'query_activation_rate',
        'query_onboarding_funnel',
        'query_drop_off_points',
        'get_funnel_analysis',
        'get_experiment_results',
        'design_experiment',
        'save_component_spec',
        'query_component_specs',
        'get_design_tokens',
        'get_color_palette',
        'get_typography_scale',
        'get_component_library',
        'get_figma_file',
        'get_figma_components',
        'post_figma_comment',
        'check_ai_smell',
        'run_accessibility_audit',
        'save_memory',
        'send_agent_message'
      ]::text[],
      2
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('vp-design', 'design-review', 'expert'),
    ('vp-design', 'design-system-management', 'expert'),
    ('vp-design', 'brand-management', 'expert'),
    ('vp-design', 'ui-development', 'expert'),
    ('ui-ux-designer', 'design-review', 'competent'),
    ('ui-ux-designer', 'design-system-management', 'competent'),
    ('ui-ux-designer', 'ux-design', 'expert'),
    ('design-critic', 'design-review', 'expert'),
    ('template-architect', 'design-system-management', 'expert'),
    ('frontend-engineer', 'design-system-management', 'competent'),
    ('cmo', 'brand-management', 'competent')
  ) AS x(agent_role, skill_slug, proficiency)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('vp-design', 'design-review', 'expert'),
    ('vp-design', 'design-system-management', 'expert'),
    ('vp-design', 'brand-management', 'expert'),
    ('vp-design', 'ui-development', 'expert'),
    ('ui-ux-designer', 'design-review', 'competent'),
    ('ui-ux-designer', 'design-system-management', 'competent'),
    ('ui-ux-designer', 'ux-design', 'expert'),
    ('design-critic', 'design-review', 'expert'),
    ('template-architect', 'design-system-management', 'expert'),
    ('frontend-engineer', 'design-system-management', 'competent'),
    ('cmo', 'brand-management', 'competent')
  ) AS x(agent_role, skill_slug, proficiency)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, hp.proficiency
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(design review|ui audit|visual qa|accessibility audit|brand compliance|ai smell)', 'design-review', 18),
    ('(?i)(design system|design token|token drift|component library|template variant|system consistency)', 'design-system-management', 17),
    ('(?i)(brand management|brand guideline|visual identity|logo|favicon|brand compliance)', 'brand-management', 17),
    ('(?i)(ui development|design implementation|frontend style|token update|component styling|figma handoff)', 'ui-development', 16),
    ('(?i)(ux design|user journey|persona|onboarding funnel|drop.off|interaction design|usability)', 'ux-design', 16)
  ) AS x(task_regex, skill_slug, priority)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM mapping_payload
)
DELETE FROM task_skill_map t
USING target_slugs s
WHERE t.skill_slug = s.skill_slug;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(design review|ui audit|visual qa|accessibility audit|brand compliance|ai smell)', 'design-review', 18),
    ('(?i)(design system|design token|token drift|component library|template variant|system consistency)', 'design-system-management', 17),
    ('(?i)(brand management|brand guideline|visual identity|logo|favicon|brand compliance)', 'brand-management', 17),
    ('(?i)(ui development|design implementation|frontend style|token update|component styling|figma handoff)', 'ui-development', 16),
    ('(?i)(ux design|user journey|persona|onboarding funnel|drop.off|interaction design|usability)', 'ux-design', 16)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

COMMIT;