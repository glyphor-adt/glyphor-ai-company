-- Deprecate legacy Pulse creative guidance and remove stale Pulse tool discovery.
-- Safe to run repeatedly.

BEGIN;

-- 1) Remove any live Pulse tool discovery paths immediately.
UPDATE agent_tool_grants
SET is_active = false,
    updated_at = NOW()
WHERE is_active = true
  AND tool_name LIKE 'pulse\_%' ESCAPE '\';

UPDATE tool_registry
SET is_active = false,
    updated_at = NOW()
WHERE is_active = true
  AND name LIKE 'pulse\_%' ESCAPE '\';

-- 2) Disable the deprecated knowledge section if it still exists.
UPDATE company_knowledge_base
SET is_active = false
WHERE section = 'pulse_mcp_guide'
  AND is_active = true;

-- 3) Remove legacy Pulse tool names from active skill grants.
UPDATE skills
SET tools_granted = ARRAY(
      SELECT tool_name
      FROM unnest(tools_granted) AS tool_name
      WHERE tool_name NOT LIKE 'pulse\_%' ESCAPE '\'
    ),
    updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM unnest(tools_granted) AS tool_name
  WHERE tool_name LIKE 'pulse\_%' ESCAPE '\'
);

-- 4) Align the content-creation skill with the current first-party creative stack.
UPDATE skills
SET description = 'Produce multi-format content — blog posts, social campaigns, email sequences, product narratives, launch assets, and supporting visuals — that position Glyphor as the leader in autonomous AI operations. Use when written strategy and first-party media production need to ship together. This skill covers research, copy, image generation, video generation, and supporting audio workflows using Glyphor''s current creative tooling.',
    methodology = $content_creation$
# Content Creation

You are a creative operator. Written strategy and first-party media production should ship together.

## Core Rule

Use only the currently loaded Glyphor creative tools. Never rely on Pulse-specific tool names, deprecated internal guides, or tool names that do not appear in your active tool list.

## Production Workflow

1. Clarify the audience, conversion target, deliverable set, and review owner.
2. Draft the written asset first so visuals reinforce a specific message instead of compensating for vague copy.
3. For static visuals, use `generate_content_image` for content graphics or `generate_image` for scene-driven assets with explicit aspect ratio, scene, and job context.
4. For motion, refine the prompt with `enhance_video_prompt`, generate clips with `generate_video`, and wait for completion with `poll_video_status` before promising a final asset.
5. For narration and sound, use `generate_voiceover`, `generate_music`, and `generate_sfx` only when the assignment explicitly benefits from audio.
6. Save outputs, collect links, and submit the full deliverable package for review.

## Web Build Media Routing

- concept: generate_image with the approved visual direction and target aspect ratio.
- product_shot: capture real screenshots first, then generate only the supporting context around them.
- editorial: use generate_image with portrait-oriented prompting and a named job context.
- hero_loop: enhance_video_prompt, then animate an approved still or storyboard frame with generate_video.
- product_demo: sequence real screenshots with generated motion clips instead of inventing product states.
- promo: write the shot list in the brief first, then produce scenes with generate_image and generate_video.

## Quality Bar

- Specific beats generic. Every asset should clearly express one idea.
- Brand-native beats trend-chasing. Avoid visuals that look like stock AI output.
- Real product context beats invented UI. Use screenshots when the product itself is the proof.
- If the current tool surface cannot deliver the requested media cleanly, escalate instead of improvising unsupported workflows.
    $content_creation$,
    tools_granted = ARRAY[
      'web_search', 'web_fetch', 'save_memory', 'send_agent_message',
      'draft_blog_post', 'draft_case_study', 'draft_email', 'draft_social_post',
      'write_content', 'create_content_draft', 'update_content_draft',
      'submit_content_for_review', 'approve_content_draft', 'reject_content_draft',
      'publish_content', 'get_content_calendar', 'get_content_drafts',
      'get_trending_topics', 'get_content_metrics', 'query_content_performance',
      'query_top_performing_content', 'validate_brand_compliance',
      'generate_content_image', 'generate_image', 'generate_video', 'poll_video_status',
      'generate_voiceover', 'generate_sfx', 'generate_music', 'enhance_video_prompt'
    ]::text[],
    version = GREATEST(version, 3) + 1,
    updated_at = NOW()
WHERE slug = 'content-creation';

-- 5) Remove stale Pulse wording from web creation skills.
UPDATE skills
SET methodology = replace(methodology, 'Pulse-ready asset manifest', 'creative asset manifest'),
    updated_at = NOW()
WHERE slug = 'advanced-web-creation'
  AND methodology LIKE '%Pulse-ready asset manifest%';

-- 6) Publish new prompt versions for the affected marketing agents.
UPDATE agent_prompt_versions
SET retired_at = NOW()
WHERE tenant_id = 'system'
  AND agent_id IN ('cmo', 'content-creator', 'social-media-manager')
  AND deployed_at IS NOT NULL
  AND retired_at IS NULL;

WITH latest_prompts AS (
  SELECT DISTINCT ON (agent_id)
    agent_id,
    prompt_text
  FROM agent_prompt_versions
  WHERE tenant_id = 'system'
    AND agent_id IN ('cmo', 'content-creator', 'social-media-manager')
  ORDER BY agent_id,
           CASE WHEN retired_at IS NULL AND deployed_at IS NOT NULL THEN 0 ELSE 1 END,
           deployed_at DESC NULLS LAST,
           created_at DESC
)
INSERT INTO agent_prompt_versions (
  agent_id,
  tenant_id,
  version,
  prompt_text,
  change_summary,
  source,
  deployed_at,
  created_at
)
SELECT
  lp.agent_id,
  'system',
  COALESCE((
    SELECT MAX(apv.version)
    FROM agent_prompt_versions apv
    WHERE apv.agent_id = lp.agent_id
      AND apv.tenant_id = 'system'
  ), 0) + 1,
  regexp_replace(
    lp.prompt_text,
    E'---\\n## PULSE INTEGRATION.*?---',
    E'---\\n## VISUAL AND VIDEO CONTENT\\n\\nUse the currently loaded Glyphor creative tools for image and video work.\\n- Use the exact tool names exposed in your active tool list.\\n- Do not use deprecated internal creative guides or legacy Pulse tool names.\\n- If visual tooling is missing for an assignment, request access instead of inventing tool names.\\n---',
    's'
  ),
  'Deprecate Pulse guidance and align marketing prompts with current first-party creative tools',
  'manual',
  NOW(),
  NOW()
FROM latest_prompts lp;

COMMIT;