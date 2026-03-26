-- Sync shared advanced web creation skill for Web Build orchestration.
-- Source:
--   skills/design/advanced-web-creation.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'advanced-web-creation',
      'advanced-web-creation',
      'design',
      'Orchestrate Web Build for complete page and application builds while preserving precise control over brand direction and quality gates. Use when a request is larger than a component tweak and requires architecture, implementation, QA, and deployment as one flow.',
      $advanced_web_creation$
# Advanced Web Creation

Use Web Build as the default path for complete page or app deliverables.

Decision rule:
- "Build me a page/app" -> Web Build orchestration.
- "Change this component/section" -> individual tools.

Core loop:
1. Write a detailed brief with audience, structure, style, brand, and requirements.
2. Run invoke_web_build with the correct tier.
3. Review quality with screenshots + AI-smell/perf checks.
4. Iterate with invoke_web_iterate for targeted changes.
5. Promote to production with invoke_web_upgrade when available.

Aim for orchestration speed without sacrificing visual craft or technical quality.
      $advanced_web_creation$,
      ARRAY[
        'invoke_web_build',
        'invoke_web_iterate',
        'invoke_web_upgrade',
        'screenshot_page',
        'check_ai_smell',
        'run_lighthouse_audit',
        'run_lighthouse_batch',
        'save_memory',
        'send_agent_message'
      ]::text[],
      1
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
    ('vp-design', 'advanced-web-creation', 'expert'),
    ('frontend-engineer', 'advanced-web-creation', 'competent'),
    ('ui-ux-designer', 'advanced-web-creation', 'competent'),
    ('cto', 'advanced-web-creation', 'competent'),
    ('cmo', 'advanced-web-creation', 'competent')
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
    ('vp-design', 'advanced-web-creation', 'expert'),
    ('frontend-engineer', 'advanced-web-creation', 'competent'),
    ('ui-ux-designer', 'advanced-web-creation', 'competent'),
    ('cto', 'advanced-web-creation', 'competent'),
    ('cmo', 'advanced-web-creation', 'competent')
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
    ('(?i)(advanced web creation|web-build build|landing page build|web app build|coming.?soon page|invoke_fuse|prototype tier|full build tier|iterate build)', 'advanced-web-creation', 18)
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
    ('(?i)(advanced web creation|web-build build|landing page build|web app build|coming.?soon page|invoke_fuse|prototype tier|full build tier|iterate build)', 'advanced-web-creation', 18)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

COMMIT;