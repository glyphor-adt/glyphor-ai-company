-- Normalize doctrine-related knowledge sections so all agents operate from
-- consistent company truths at runtime and in generated outputs.

BEGIN;

WITH doctrine_updates (section, title, content, audience, last_edited_by) AS (
  VALUES
    (
      'current_priorities',
      'Current Priorities',
      $$1. Operate the AI agent workforce autonomously with quality and governance gates.
2. Ship AI Marketing Department customer outcomes through Slack-first delivery.
3. Protect margin and monitor infrastructure costs continuously.
4. Strengthen data pipelines and observability for reliable operations.
5. Focus on SMB founder-led teams (5-50 employees); defer enterprise workflows in this phase.$$,
      'all',
      'system'
    ),
    (
      'pricing',
      'Pricing Strategy',
      $$AI Marketing Department pricing posture for the current phase:
- Target range: $500-750 per month
- Packaging is intentionally simple and predictable
- Final packaging remains under founder validation

Deprecated framing (must not be used):
- Legacy $15-$50 references
- Positioning Pulse or Fuse as customer-facing standalone pricing plans$$,
      'all',
      'system'
    ),
    (
      'products',
      'Products',
      $$External product in this phase:
- AI Marketing Department, delivered through Slack for founder-led SMBs

Internal engines (not customer-facing standalone products):
- Pulse (creative generation engine)
- Fuse (development acceleration engine)

Positioning guardrails:
- Keep customer-facing messaging anchored in AI Marketing Department outcomes
- Do not present Pulse/Fuse/Revy/Cockpit as external products$$,
      'all',
      'system'
    ),
    (
      'decision_log',
      'Founder Decision Log - Settled Decisions',
      $$These decisions are settled and should not be re-proposed without explicit founder direction.

Strategy
- AI Marketing Department is the only external product in this phase.
- Pulse and Fuse are internal engines, not standalone external offerings.
- Slack-first delivery is the active go-to-market wedge.
- SMB founder-led focus in this phase; enterprise motions are deferred.

Pricing
- Current target posture is $500-750/month.
- Legacy low-ticket pricing framing is deprecated.

Operations
- Company doctrine in company_knowledge_base is source of truth for strategic alignment.
- If prompts, memory, or stale docs conflict with doctrine, doctrine wins.$$,
      'all',
      'system'
    )
)
INSERT INTO company_knowledge_base (section, title, content, audience, last_edited_by, is_active)
SELECT section, title, content, audience, last_edited_by, true
FROM doctrine_updates
ON CONFLICT (section) DO UPDATE
SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  audience = EXCLUDED.audience,
  last_edited_by = EXCLUDED.last_edited_by,
  is_active = true,
  version = CASE
    WHEN company_knowledge_base.title IS DISTINCT FROM EXCLUDED.title
      OR company_knowledge_base.content IS DISTINCT FROM EXCLUDED.content
      OR company_knowledge_base.audience IS DISTINCT FROM EXCLUDED.audience
      OR company_knowledge_base.is_active IS DISTINCT FROM true
    THEN COALESCE(company_knowledge_base.version, 1) + 1
    ELSE company_knowledge_base.version
  END,
  updated_at = NOW();

-- Retire stale/conflicting active bulletins if they still exist.
UPDATE founder_bulletins
SET is_active = false,
    expires_at = COALESCE(expires_at, NOW())
WHERE is_active = true
  AND (
    content ILIKE '%enterprise prospect research%'
    OR content ILIKE '%Fix telemetry blackout (P0)%'
    OR content ILIKE '%$15-$50%'
    OR content ILIKE '%Fuse: Free tier%'
    OR content ILIKE '%Pulse launch messaging%'
  );

-- Publish a single consolidation bulletin to reinforce doctrine alignment.
INSERT INTO founder_bulletins (created_by, content, audience, priority, is_active)
SELECT
  'kristina.denney',
  'Doctrine normalization complete: AI Marketing Department is the only external product, pricing posture is $500-750/month, Slack-first delivery remains active, and enterprise workflows are deferred in this phase.',
  'all',
  'important',
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM founder_bulletins
  WHERE is_active = true
    AND content ILIKE 'Doctrine normalization complete:%'
);

COMMIT;
