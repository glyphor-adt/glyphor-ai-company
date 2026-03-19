-- ═══════════════════════════════════════════════════════════════════════
-- Knowledge System v2 — Schema + Data Migration
--
-- Adds layered ownership, freshness tracking, and versioned change log
-- to company_knowledge_base. Converts flat broadcast injection to
-- Layer 1 (doctrine, always injected) / Layer 2 (role context) /
-- Layer 3 (retrievable on demand).
--
-- Column mapping: the existing table uses `section` (not `key`).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── STEP 1: Schema Changes ──────────────────────────────────────────

-- Drop the strict audience CHECK so we can use comma-separated audiences
ALTER TABLE company_knowledge_base DROP CONSTRAINT IF EXISTS company_knowledge_base_audience_check;

-- Add metadata columns (version already exists, skip)
ALTER TABLE company_knowledge_base
  ADD COLUMN IF NOT EXISTS layer INTEGER NOT NULL DEFAULT 2
    CHECK (layer IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS owner_agent_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS review_cadence TEXT NOT NULL DEFAULT 'monthly'
    CHECK (review_cadence IN ('on_change', 'weekly', 'monthly', 'quarterly', 'never')),
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verified_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_expire BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_section_key TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS change_summary TEXT DEFAULT NULL;

-- Knowledge change history (append-only log)
CREATE TABLE IF NOT EXISTS knowledge_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  previous_content TEXT,
  new_content TEXT,
  change_summary TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kcl_section ON knowledge_change_log(section_key);
CREATE INDEX IF NOT EXISTS idx_kcl_changed_at ON knowledge_change_log(changed_at DESC);

-- Live reference resolvers (replaces hardcoded facts in KB sections)
CREATE TABLE IF NOT EXISTS knowledge_live_refs (
  key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  description TEXT,
  last_resolved_at TIMESTAMPTZ,
  cached_value TEXT
);

INSERT INTO knowledge_live_refs (key, query, description) VALUES
  ('active_agent_count',
   $$SELECT COUNT(*) FROM company_agents WHERE status = 'active'$$,
   'Number of active agents in the fleet'),
  ('current_mrr',
   $$SELECT COALESCE(MAX(value), '$0 (pre-revenue)') FROM metrics WHERE key = 'mrr'$$,
   'Current MRR'),
  ('compute_cost_monthly',
   $$SELECT COALESCE(ROUND(SUM(total_cost_usd)::numeric, 2)::text || '/mo', 'not yet instrumented') FROM agent_runs WHERE created_at > NOW() - INTERVAL '30 days'$$,
   'Estimated monthly compute cost from instrumented runs')
ON CONFLICT (key) DO NOTHING;

-- Indexes for layer-based queries
CREATE INDEX IF NOT EXISTS idx_ckb_layer ON company_knowledge_base (layer) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ckb_layer_audience ON company_knowledge_base (layer, audience) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ckb_stale ON company_knowledge_base (is_stale) WHERE is_stale = true;

-- ─── STEP 2: Rewrite Layer 1 Doctrine Sections ──────────────────────

-- Log all current Layer 1 candidates before overwriting
INSERT INTO knowledge_change_log (section_key, version, previous_content, change_summary, changed_by)
SELECT section, COALESCE(version, 1), content, 'Pre-overhaul snapshot', 'founder:kristina'
FROM company_knowledge_base
WHERE section IN ('mission','authority_model','founders','culture','products','operating_doctrine');

-- MISSION — Layer 1, founders-owned, never auto-expires
UPDATE company_knowledge_base SET
  content = 'Glyphor builds AI-powered departments that deliver outcomes. We sell functional work, not software interfaces. The only external product is the AI Marketing Department — an AI team embedded into customer Slack workspaces that produces social content, short-form videos, blog drafts, email campaigns, and performance reporting. Internal capabilities (Pulse, Fuse) power the department but are never surfaced to customers. We are revenue-first, capital-efficient, and pre-scale. One department ships, validates, and embeds before any expansion occurs.',
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Rewritten to doctrine layer — condensed, accurate, doctrine-aligned'
WHERE section = 'mission';

-- AUTHORITY MODEL — Layer 1
UPDATE company_knowledge_base SET
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Promoted to Layer 1 doctrine'
WHERE section = 'authority_model';

-- FOUNDERS — Layer 1
UPDATE company_knowledge_base SET
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Promoted to Layer 1 doctrine'
WHERE section = 'founders';

-- CULTURE — Layer 1
UPDATE company_knowledge_base SET
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Promoted to Layer 1 doctrine'
WHERE section = 'culture';

-- PRODUCTS — Layer 1
UPDATE company_knowledge_base SET
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Promoted to Layer 1 doctrine'
WHERE section = 'products';

-- OPERATING DOCTRINE — condensed Layer 1 summary
UPDATE company_knowledge_base SET
  content = 'Revenue validation and retention validation are the immediate objectives. Revenue proves demand. Retention proves value. The sequence is: launch one department → validate revenue → validate retention → systemize delivery → embed deeply → accumulate brand knowledge → protect margins → expand. Expansion to additional departments only after revenue and retention milestones are met. No exceptions. Scope creep — drifting into consulting behavior while charging product pricing — is the primary failure mode to detect and prevent.',
  layer = 1,
  audience = 'all',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Condensed to doctrine-layer summary. Full doc available as Layer 3 retrievable.'
WHERE section = 'operating_doctrine';

-- SCOPE DEFINITION — new Layer 1 section
INSERT INTO company_knowledge_base (section, title, content, layer, audience, owner_agent_id, review_cadence, last_verified_at, verified_by, auto_expire, version, change_summary)
VALUES (
  'scope_definition',
  'AI Marketing Department — Scope Definition',
  'IN SCOPE: A defined volume of social media posts, short-form videos (powered by Pulse), blog drafts, email campaign drafts, and performance reporting.
OUT OF SCOPE: Unlimited custom content, paid ad management (initial phase), bespoke brand strategy consulting, open-ended creative production, human-like advisory services.
RULE: Any request that expands scope without a corresponding pricing change reduces margins. Detect scope creep and flag it. Do not silently absorb out-of-scope requests.',
  1,
  'all',
  'cmo',
  'monthly',
  NOW(),
  'founder:kristina',
  FALSE,
  1,
  'New section — scope discipline from strategic doctrine'
) ON CONFLICT (section) DO NOTHING;

-- ─── STEP 3: Fix Conflicting and Stale Sections ─────────────────────

-- FIX PRICING — mark as unverified, auto-expire enabled
UPDATE company_knowledge_base SET
  content = 'Target range $500-750/mo under active consideration. NOT YET FINALIZED. Do not quote specific pricing as confirmed to any customer or prospect. Pricing must be validated through unit economics, compute cost analysis, and market testing before being stated as fixed. Direct all pricing questions to founders. Simple and predictable model — no usage-based pricing, no credits, no unnecessary tiering.',
  layer = 2,
  audience = 'marketing,sales,executive',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NULL,
  auto_expire = TRUE,
  is_stale = TRUE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Corrected: pricing is provisional not confirmed. Marked auto_expire.'
WHERE section = 'pricing';

-- FIX ICP PROFILE
UPDATE company_knowledge_base SET
  content = 'Primary ICP: founder-led SMBs (5-50 employees), Slack-based, needs consistent marketing output without a full in-house team. Short decision cycles, practical evaluation, value simplicity and fast time-to-value.
INITIAL LAUNCH: Slack-first. Teams integration is planned as a parallel surface — Teams-only orgs are deferred, not excluded.
NOT FITTING THIS PHASE: Enterprise procurement, regulated industries, complex multi-stakeholder buying processes.
PRICING FIT: Customers who cannot justify a full-time marketing hire or agency retainer at traditional rates.',
  layer = 2,
  audience = 'marketing,sales,executive',
  owner_agent_id = 'cmo',
  review_cadence = 'monthly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Corrected: removed Teams exclusion (Teams is deferred not excluded per doctrine)'
WHERE section = 'icp_profile';

-- FIX METRICS — replace hardcoded counts with live ref
UPDATE company_knowledge_base SET
  content = 'MRR: $0 (pre-revenue, pre-launch). 0 paying customers.
Active agents: see live count — do not use any hardcoded number.
Compute target: $150/mo.
Rule: Do NOT report any MRR or user count other than $0 / 0 until founders update this section.
Live references resolved at injection time: {active_agent_count} agents active.',
  layer = 3,
  audience = 'executive,finance,operations',
  owner_agent_id = 'cfo',
  review_cadence = 'weekly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = TRUE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Fixed hardcoded agent count. Moved to Layer 3 (retrievable). Added live ref.'
WHERE section = 'metrics';

-- FIX TEAM_STRUCTURE — move to Layer 3, add live ref
UPDATE company_knowledge_base SET
  content = 'Glyphor has {active_agent_count} active AI agents + 2 human founders (Kristina = CEO, Andrew = COO).
Agent roster by department is maintained in the company_agents table — do not reference specific counts from this section as they change. Query the agents table directly for current headcount.',
  layer = 3,
  audience = 'executive,operations',
  owner_agent_id = 'chief-of-staff',
  review_cadence = 'monthly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Replaced hardcoded counts with live ref. Moved to Layer 3.'
WHERE section = 'team_structure';

-- FIX DECISION LOG — Pulse is not deprecated, it is internal-only
UPDATE company_knowledge_base SET
  content = 'Settled decisions (do not re-open without founder directive):
- AI Marketing Department is the only external product this phase
- Slack-first GTM (Teams planned as parallel surface, not primary)
- Pulse and Fuse are internal capabilities, not standalone external products
- Flat-rate pricing model (specific price point under validation)
- No enterprise/regulated expansion this phase
- No new external products until revenue and retention milestones met',
  layer = 3,
  audience = 'executive,operations',
  owner_agent_id = NULL,
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = FALSE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Corrected: Pulse is internal-only not deprecated. Added Teams clarification.'
WHERE section = 'decision_log';

-- FIX CURRENT PRIORITIES — separate strategic from operational
UPDATE company_knowledge_base SET
  content = 'STRATEGIC PRIORITY (always): Revenue validation → Retention validation → Systemize delivery → Embed deeply → Expand. This sequence does not change month to month.
MARCH 2026 OPERATIONAL FOCUS:
1. Platform health stabilization (internal — eval scoring, agent quality)
2. Brand voice and identity system
3. Competitive landscape research
4. Slack AI Marketing Department landing page
5. Still You campaign launch
Note: Operational priorities update monthly. Strategic sequence does not.',
  layer = 2,
  audience = 'all',
  owner_agent_id = 'chief-of-staff',
  review_cadence = 'monthly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  auto_expire = TRUE,
  version = COALESCE(version, 1) + 1,
  change_summary = 'Separated strategic sequence from monthly operational priorities'
WHERE section = 'current_priorities';

-- FIX CUSTOMER EXPERIENCE — Layer 2 marketing/sales
UPDATE company_knowledge_base SET
  layer = 2,
  audience = 'marketing,sales',
  owner_agent_id = 'cmo',
  review_cadence = 'monthly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  version = COALESCE(version, 1) + 1,
  change_summary = 'Scoped to marketing/sales Layer 2'
WHERE section = 'customer_experience';

-- FIX OPERATIONS — Layer 2 ops
UPDATE company_knowledge_base SET
  layer = 2,
  audience = 'operations',
  owner_agent_id = 'chief-of-staff',
  review_cadence = 'on_change',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina',
  version = COALESCE(version, 1) + 1,
  change_summary = 'Scoped to operations Layer 2'
WHERE section = 'operations';

-- ─── STEP 4: Split Standing Orders by Department ─────────────────────

-- Archive the monolithic standing_orders as Layer 3 ops-only
UPDATE company_knowledge_base SET
  layer = 3,
  audience = 'operations',
  change_summary = 'Deprecated: split into department-scoped sections. Retained for ops reference only.'
WHERE section = 'standing_orders';

-- Insert department-scoped standing orders
INSERT INTO company_knowledge_base (section, title, content, layer, audience, owner_agent_id, review_cadence, last_verified_at, verified_by, auto_expire)
VALUES

('standing_orders_marketing', 'Standing Orders — Marketing',
'WEEKLY: 3 LinkedIn posts (thought leadership + product), competitive content sweep, 1 blog draft, email campaign draft if applicable.
DAILY: Monitor social engagement, respond to comments on published content, track keyword rankings.
MONTHLY: Content performance report, SEO keyword strategy review, campaign results summary.',
2, 'marketing', 'cmo', 'monthly', NOW(), 'founder:kristina', FALSE),

('standing_orders_engineering', 'Standing Orders — Engineering',
'WEEKLY: Platform health review (error rates, latency, cost per run), dependency security scan, deployment pipeline check.
DAILY: Monitor agent run failures and error logs, flag P0 infrastructure issues immediately.
MONTHLY: Infrastructure cost breakdown, model routing performance review, capacity planning.',
2, 'engineering', 'cto', 'monthly', NOW(), 'founder:kristina', FALSE),

('standing_orders_finance', 'Standing Orders — Finance',
'WEEKLY: Compute cost breakdown by agent and model, runway projection update.
DAILY: Flag any spend anomalies above $10/day.
MONTHLY: Unit economics analysis, cost-per-output by department, pricing model validation inputs.',
2, 'finance', 'cfo', 'monthly', NOW(), 'founder:kristina', FALSE),

('standing_orders_research', 'Standing Orders — Research',
'WEEKLY: Competitive landscape sweep (key competitors: Sierra, Devin, Ema, Lindy, Viktor, 11x, Artisan, Agentforce), market signal summary.
MONTHLY: Trends summary, competitor feature delta report.',
2, 'research', 'vp-research', 'monthly', NOW(), 'founder:kristina', FALSE),

('standing_orders_sales', 'Standing Orders — Sales',
'WEEKLY: 3-5 qualified prospects identified and researched, outreach drafted.
MONTHLY: Pipeline review, ICP validation against actual prospect responses.',
2, 'sales', 'vp-sales', 'monthly', NOW(), 'founder:kristina', FALSE),

('standing_orders_ops', 'Standing Orders — Operations',
'WEEKLY: Fleet health audit, KB freshness audit, GTM readiness check, cross-department blocker sweep.
DAILY: Agent run error monitoring, escalation triage.
MONTHLY: Full platform intelligence report to founders, operating metrics review.',
2, 'operations', 'chief-of-staff', 'monthly', NOW(), 'founder:kristina', FALSE)

ON CONFLICT (section) DO NOTHING;

-- ─── STEP 5: Demote Layer 3 Sections ─────────────────────────────────

-- These become Layer 3 retrievable — never auto-injected
UPDATE company_knowledge_base SET layer = 3 WHERE section IN (
  'competitive_landscape',
  'glossary',
  'tool_inventory',
  'infrastructure'
);

-- Set appropriate audience + ownership
UPDATE company_knowledge_base SET
  audience = 'marketing,sales,research,executive',
  owner_agent_id = 'vp-research',
  review_cadence = 'weekly',
  last_verified_at = NOW()
WHERE section = 'competitive_landscape';

UPDATE company_knowledge_base SET
  audience = 'all',
  review_cadence = 'on_change',
  last_verified_at = NOW()
WHERE section = 'glossary';

UPDATE company_knowledge_base SET
  audience = 'engineering,operations',
  owner_agent_id = 'cto',
  review_cadence = 'monthly',
  last_verified_at = NOW()
WHERE section = 'tool_inventory';

UPDATE company_knowledge_base SET
  audience = 'engineering,operations',
  owner_agent_id = 'cto',
  review_cadence = 'monthly',
  last_verified_at = NOW()
WHERE section = 'infrastructure';

-- Brand guide was already moved to marketing-only in previous migration;
-- promote to Layer 3 (retrievable) with proper metadata
UPDATE company_knowledge_base SET
  layer = 3,
  owner_agent_id = 'cmo',
  review_cadence = 'quarterly',
  last_verified_at = NOW(),
  verified_by = 'founder:kristina'
WHERE section = 'brand_guide';

COMMIT;
