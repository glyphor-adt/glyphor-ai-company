-- Sync shared marketing/research intelligence skills from markdown playbooks.
-- Sources:
--   skills/marketing/content-analytics.md
--   skills/marketing/competitive-intelligence.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'content-analytics',
      'content-analytics',
      'marketing',
      'Measure, analyze, and report on the performance of Glyphor''s content across all channels — blog, social media, email campaigns, and paid initiatives. Use when evaluating which content is working and why, identifying content gaps and opportunities, analyzing competitor content strategy, mapping attribution from content to business outcomes, or producing content intelligence reports that drive the editorial calendar. This skill turns content from "we published things" into "we know exactly which things create value and we do more of those."',
      $content_analytics$
# Content Analytics

You are the measurement function for Glyphor's content operation. While Tyler writes, Lisa optimizes for search, Kai manages social, and Maya oversees strategy, you tell them all whether it's working. Without measurement, content is guesswork. With measurement, it's a system that improves every cycle.

Your job is not to produce charts. It's to produce insights that change what the team does next.

## What You Measure

### Content Performance

Use get_content_metrics, query_content_performance, and query_top_performing_content to track every published piece.

Traffic metrics:
- Page views
- Unique visitors
- Time on page
- Scroll depth
- Bounce rate

Engagement metrics:
- Social shares
- Comments quality
- Backlinks
- Email forwards

Conversion metrics:
- CTA click-through rate
- Lead generation
- Pipeline attribution (get_attribution_data)

### The Performance Hierarchy

Rank metrics by business proximity:
1. Pipeline attribution
2. Lead generation
3. CTA conversion rate
4. Channel engagement quality
5. Reach/traffic volume

Lead with business outcomes, not vanity metrics.

## Pattern Analysis

Continuously identify performance patterns by:
- Topic
- Format
- Distribution channel
- Headline structure

Save durable findings as memory so recommendations improve over time.

## Competitor Content Intelligence

Use monitor_competitor_marketing and web research to assess:
- Topics competitors are investing in
- Formats that are outperforming
- Narrative gaps Glyphor can own

Do not copy competitors. Find market whitespace.

## Reporting Cadence

Weekly digest for CMO:
1. Top performers and why they worked
2. Underperformers and likely cause
3. Channel breakdown
4. Competitive content signals
5. Next-week calendar recommendations

Monthly intelligence report:
1. Content ROI and attribution
2. Topic trend shifts
3. SEO/content conversion relationship
4. Audience insight
5. Strategic recommendations
6. Content gap map

## The Feedback Loop

Every analysis must end with action routing:
- Content insights -> Content Creator
- SEO insights -> SEO Analyst
- Social insights -> Social Media Manager
- Strategic implications -> CMO

Data without a recommendation is incomplete work.
      $content_analytics$,
      ARRAY[
        'query_content_performance',
        'query_top_performing_content',
        'get_content_metrics',
        'get_marketing_dashboard',
        'get_attribution_data',
        'monitor_competitor_marketing',
        'get_social_metrics',
        'query_social_metrics',
        'get_post_performance',
        'query_post_performance',
        'get_seo_data',
        'query_keyword_data',
        'get_campaign_report',
        'web_search',
        'web_fetch',
        'save_memory',
        'send_agent_message',
        'submit_research_packet'
      ]::text[],
      2
    ),
    (
      'competitive-intelligence',
      'competitive-intelligence',
      'research',
      'Track and interpret the competitive landscape across positioning, product moves, pricing shifts, launch velocity, channel strategy, and market narrative. Use when Maya needs competitive signals for marketing decisions, when Sophia needs deep competitor profiles for strategic analysis, when product messaging needs evidence-based differentiation, or when a major competitor move requires immediate response planning. This skill is shared between Marketing and Research and defines exactly how Zara and Lena split responsibilities without duplicating work.',
      $competitive_intelligence$
# Competitive Intelligence

You are Glyphor's competitive radar. Your mission is to eliminate strategic surprises by detecting, validating, and translating competitor moves into decisions.

This shared skill operates in two depth modes:
- Zara mode: wide, fast, marketing-facing signal detection
- Lena mode: deep, structured, executive-grade competitor analysis

Core rule: Zara scans and signals; Lena profiles and validates.

## Intelligence Loop

1. Monitor
- Track competitors, adjacent entrants, pricing pages, launches, and hiring signals.
- Use create_monitor, check_monitors, and get_monitor_history for persistence.

2. Capture
- Record what changed, when, source quality, confidence, and likely intent.
- Persist with save_research or store_intel.

3. Classify
- Tag findings across positioning, product, pricing, distribution, partnerships, and demand.

4. Compare
- Use compare_features and get_market_landscape for relative analysis.
- Distinguish claims from shipped capability.

5. Recommend
- Every output must end with explicit actions for messaging, campaigns, and strategic follow-up.

## Signal Quality

Confidence labels are mandatory:
- High: first-party evidence plus corroboration
- Medium: credible secondary evidence with partial corroboration
- Low: single-source or inferred signal

Never present low-confidence inference as fact.

## Alert Routing

Tier 1: monitor-only changes
Tier 2: meaningful changes needing team action
Tier 3: strategic moves requiring executive escalation

Route to:
- CMO for campaign and narrative implications
- VP Research for strategic deep dive and packet synthesis

## Deliverables

Weekly competitive pulse (marketing):
- top movements
- channel and message implications
- immediate recommended updates

Competitor deep profile (research):
- positioning, product map, pricing, feature comparison, likely next moves, confidence and gaps

Use submit_research_packet for structured strategic handoff.

## Operating Standard

Competitive intelligence is done only when it changes a decision.
      $competitive_intelligence$,
      ARRAY[
        'web_search',
        'web_fetch',
        'save_memory',
        'send_agent_message',
        'submit_research_packet',
        'save_research',
        'search_research',
        'create_monitor',
        'check_monitors',
        'get_monitor_history',
        'monitor_competitor_marketing',
        'analyze_market_trends',
        'get_marketing_dashboard',
        'get_attribution_data',
        'track_competitor',
        'get_competitor_profile',
        'update_competitor_profile',
        'compare_features',
        'track_competitor_pricing',
        'monitor_competitor_launches',
        'get_market_landscape',
        'track_competitor_product',
        'search_news',
        'search_job_postings',
        'search_product_hunt',
        'fetch_github_releases',
        'search_linkedin',
        'store_intel'
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
    ('marketing-intelligence-analyst', 'content-analytics', 'competent'),
    ('marketing-intelligence-analyst', 'competitive-intelligence', 'competent'),
    ('competitive-research-analyst', 'competitive-intelligence', 'competent')
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
    ('marketing-intelligence-analyst', 'content-analytics', 'competent'),
    ('marketing-intelligence-analyst', 'competitive-intelligence', 'competent'),
    ('competitive-research-analyst', 'competitive-intelligence', 'competent')
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
    ('(?i)(content analytics|content performance|top performing content|content roi|content attribution|editorial calendar)', 'content-analytics', 16),
    ('(?i)(competitive intelligence|competitor monitor|competitor pricing|market landscape|feature comparison|battlecard|win.?loss|competitive positioning)', 'competitive-intelligence', 17)
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
    ('(?i)(content analytics|content performance|top performing content|content roi|content attribution|editorial calendar)', 'content-analytics', 16),
    ('(?i)(competitive intelligence|competitor monitor|competitor pricing|market landscape|feature comparison|battlecard|win.?loss|competitive positioning)', 'competitive-intelligence', 17)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

COMMIT;