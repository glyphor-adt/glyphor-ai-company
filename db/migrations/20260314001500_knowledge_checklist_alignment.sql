-- Knowledge checklist alignment
-- Adds missing doctrine sections and aligns bulletin/pulse snapshots.

INSERT INTO company_knowledge_base (section, title, content, audience, last_edited_by, is_active)
VALUES
(
  'glossary',
  'Internal Terminology - External Usage Rules',
  $$- Pulse: Internal creative engine. Do not use as a customer-facing product name.
- Fuse: Internal development acceleration engine. Do not position as external product.
- Reve/Revy: Future roadmap initiative. Do not reference externally.
- Cockpit: Internal dashboard for orchestration/governance. Not customer-facing.
- Ora: Internal multi-model chat capability. Internal use only.
- Prism: Internal design system naming.
- MCP: Internal infrastructure term. Avoid in customer-facing copy.
- Knowledge Graph / GraphRAG: Internal intelligence infrastructure. Avoid externally.
- AI Marketing Department: The external product name. Use this in customer-facing communication.
Rule: If a customer would not understand the term, do not use it externally.$$,
  'all',
  'system',
  true
),
(
  'customer_experience',
  'Customer Experience - AI Marketing Department',
  $$Onboarding:
1. Customer installs Glyphor into Slack.
2. Onboarding captures company context, audience, brand inputs, and priorities.
3. Agents produce first recommendations quickly.

Daily operation:
- Work happens in Slack channels and threads.
- Customers request, review, and approve deliverables in Slack.
- Deliverables include social drafts, blog drafts, campaign support, SEO insights, and summaries.

Customers do not see:
- Internal orchestration and infrastructure.
- Internal tool names.
- Internal model routing details.

Objection handling baseline:
- This is not a single prompt response; it is a coordinated specialist team workflow.
- Flat-rate pricing is intended to be predictable for SMB buyers.
- Feedback loops in Slack improve fit over time.$$,
  'all',
  'system',
  true
),
(
  'tool_inventory',
  'Tool Inventory and Failure Handling',
  $$Agent tooling is provided through internal MCP servers, Microsoft Agent 365 integrations, and shared runtime tools.

Common failure interpretation:
- Empty content: likely missing data/content, not server failure.
- Connection error/timeouts: likely server or auth issue.
- Permission denied: tool grant mismatch.

When a tool fails:
1. Retry once.
2. Classify: content gap vs infrastructure failure.
3. If infrastructure, flag assignment blocker to engineering/ops.
4. Continue available work where possible.

Note: Validate exact server names and assignments against live tool_registry before external reporting.$$,
  'all',
  'system',
  true
),
(
  'icp_profile',
  'Ideal Customer Profile - AI Marketing Department',
  $$Primary ICP:
- Founder-led SMB organizations (5-50 employees).
- Slack-based operating environment.
- Needs consistent marketing output without full in-house team overhead.

Buying behavior:
- Short decision cycles.
- Practical evaluation criteria: output quality, speed, predictability, and ease of use.

Not primary fit in this phase:
- Enterprise procurement-heavy buyers.
- Regulated workflows requiring custom compliance programs.
- Teams-only organizations before Teams GTM phase.$$,
  'all',
  'system',
  true
),
(
  'decision_log',
  'Founder Decision Log - Settled Decisions',
  $$Settled strategic decisions:
- AI Marketing Department is the external product focus for this phase.
- Slack-first GTM is the active wedge.
- Pulse and Fuse are internal capabilities for current strategy framing.
- Product Hunt Pulse-first strategy is deprecated.
- Simple flat-rate pricing posture remains target direction.

Operational rule:
- Do not re-open settled decisions without explicit founder directive.$$,
  'all',
  'system',
  true
)
ON CONFLICT (section) DO UPDATE
SET title = EXCLUDED.title,
    content = EXCLUDED.content,
    audience = EXCLUDED.audience,
    last_edited_by = EXCLUDED.last_edited_by,
    is_active = true,
    version = COALESCE(company_knowledge_base.version, 1) + 1,
    updated_at = NOW();

-- Align product section agent count phrasing where present.
UPDATE company_knowledge_base
SET content = REPLACE(content, '30 agents', '28 agents'),
    updated_at = NOW()
WHERE section = 'products'
  AND content LIKE '%30 agents%';

-- Deactivate stale bulletins if founder_bulletins exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'founder_bulletins'
  ) THEN
    UPDATE founder_bulletins
    SET is_active = false,
        expires_at = COALESCE(expires_at, NOW())
    WHERE is_active = true
      AND (
        content ILIKE '%Pulse launches first%'
        OR content ILIKE '%Product Hunt%'
        OR content ILIKE '%B2C/prosumer%'
        OR content ILIKE '%$15-50%'
      );

    INSERT INTO founder_bulletins (created_by, content, audience, priority, expires_at, is_active)
    SELECT 'kristina',
           'AI Marketing Department is the external product focus. Use Slack-first positioning and avoid deprecated Pulse-first launch language.',
           'all',
           'important',
           NOW() + INTERVAL '90 days',
           true
    WHERE NOT EXISTS (
      SELECT 1
      FROM founder_bulletins
      WHERE is_active = true
        AND content ILIKE 'AI Marketing Department is the external product focus%'
    );
  END IF;
END $$;

-- Update company pulse snapshot if table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'company_pulse'
  ) THEN
    UPDATE company_pulse
    SET mrr = 0,
        active_users = 2,
        platform_status = 'degraded',
        company_mood = 'building',
        highlights = ARRAY[
          'AI Marketing Department is the only external product',
          'Pre-revenue: $0 MRR, 0 customers',
          '28 AI agents active, platform health stabilization in progress',
          'Slack-first GTM, $500-750/month target pricing',
          'Brand guide rollout and campaign preparation in progress',
          'Competitive landscape research in progress',
          'Bootstrapped: founder-funded, no external investors'
        ],
        updated_at = NOW()
    WHERE id = 1;
  END IF;
END $$;
