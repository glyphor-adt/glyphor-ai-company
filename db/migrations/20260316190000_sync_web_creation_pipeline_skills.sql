-- Sync web creation pipeline skills for implementation directive.
-- Updates:
--   - advanced-web-creation (mandatory pipeline + Codex invocation)
--   - elite-design-review (new strict quality gate skill)
--   - content-creation (web build media routing)

BEGIN;

-- 1) advanced-web-creation
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
VALUES (
  'advanced-web-creation',
  'advanced-web-creation',
  'design',
  'Execute Glyphor''s end-to-end web creation pipeline from normalized brief to quality-gated ship.',
  $advanced$
# Advanced Web Creation

Mandatory sequence:
1. normalize_design_brief
2. codex build from template
3. deploy_preview + screenshot_page at 1440/1024/768/375
4. check_ai_smell + run_accessibility_audit
5. design critic review
6. codex-reply iteration (max 3 rounds)
7. ship

Brief must include: audience persona, primary conversion, emotional target, one-sentence memory, specific aesthetic direction, component inventory, and Pulse-ready asset manifest.

Codex invocation pattern:
- repo: glyphor-adt/web-template-react
- branch: feature/initial-build
- skill: ux-engineer
- approval_policy: never
- sandbox: workspace-write
  $advanced$,
  ARRAY[
    'normalize_design_brief',
    'codex',
    'codex-reply',
    'deploy_preview',
    'screenshot_page',
    'check_ai_smell',
    'run_accessibility_audit',
    'save_memory',
    'send_agent_message',
    'invoke_fuse_build',
    'invoke_fuse_iterate',
    'invoke_fuse_upgrade'
  ]::text[],
  2
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

-- Ensure holders for advanced-web-creation stay aligned.
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT holder.agent_role, s.id, holder.proficiency
FROM (VALUES
  ('vp-design', 'expert'),
  ('frontend-engineer', 'expert'),
  ('ui-ux-designer', 'expert'),
  ('cto', 'expert'),
  ('cmo', 'expert')
) AS holder(agent_role, proficiency)
JOIN skills s ON s.slug = 'advanced-web-creation'
JOIN company_agents ca ON ca.role = holder.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

-- 2) elite-design-review (new skill)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
VALUES (
  'elite-design-review',
  'elite-design-review',
  'design',
  'Strict pass/fail quality gate for web builds with automated pre-checks and a 100-point rubric.',
  $elite$
# Elite Design Review

Pre-check gates before scoring:
- check_ai_smell (any flag => revision)
- run_accessibility_audit (any WCAG AA failure => block)
- screenshot_page at 1440/1024/768/375 (any breakpoint break => revision)

Rubric (100 points):
- Visual distinction: 25
- Technical execution: 25
- Typography: 20
- Interaction and animation: 15
- Accessibility: 15

Feedback format is mandatory:
- component
- property
- current -> target value
- expected score impact

Post-ship (90+): save design contract, score breakdown, strengths, prompt wins, and update ux-engineer proven patterns/common deductions.
  $elite$,
  ARRAY[
    'check_ai_smell',
    'run_accessibility_audit',
    'screenshot_page',
    'compare_screenshots',
    'run_lighthouse_audit',
    'save_memory',
    'send_agent_message'
  ]::text[],
  1
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT holder.agent_role, s.id, holder.proficiency
FROM (VALUES
  ('design-critic', 'expert'),
  ('vp-design', 'competent'),
  ('ui-ux-designer', 'competent')
) AS holder(agent_role, proficiency)
JOIN skills s ON s.slug = 'elite-design-review'
JOIN company_agents ca ON ca.role = holder.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

INSERT INTO task_skill_map (task_regex, skill_slug, priority)
VALUES
  ('(?i)(elite design review|web quality gate|90\+ score|review rubric|ai smell review|wcag review)', 'elite-design-review', 19)
ON CONFLICT DO NOTHING;

-- 3) content-creation routing update
UPDATE skills
SET
  methodology = CASE
    WHEN methodology ILIKE '%Web Build Media Routing (Required)%' THEN methodology
    ELSE methodology ||
      E'\n\n## Web Build Media Routing (Required)\n\nWhen receiving image_manifest/video_manifest from a web build, route by type:\n- concept -> pulse_enhance_prompt then pulse_generate_concept_image\n- product_shot -> screenshot first then pulse_product_recontext\n- editorial -> portrait prompting with pulse_generate_concept_image\n- pattern -> pulse_generate_concept_image then pulse_upscale_image\n- hero_loop -> pulse_enhance_video_prompt then pulse_kling_text_to_video\n- product_demo -> key-state screenshots then pulse_kling_image_to_video\n- promo -> pulse_create_storyboard_from_idea then pulse_create_hero_promo\n\nAfter each asset, commit to public/images/{fileName} or public/videos/{fileName}.',
  END,
  version = GREATEST(version, 4),
  updated_at = NOW()
WHERE slug = 'content-creation';

COMMIT;
