-- Align agent models with ROLE_COST_TIER from packages/shared/src/models.ts
-- ═══════════════════════════════════════════════════════════════════
--
-- Problem: Every agent in company_agents has model = 'gemini-3-flash-preview'
-- (the pro tier at $0.50/$3.00 per 1M tokens). Economy and standard
-- agents are paying 6-7x more than they should.
--
-- After this migration:
--   economy  roles → gemini-2.5-flash-lite        ($0.10/$0.40)
--   standard roles → gemini-3.1-flash-lite-preview ($0.25/$1.50)
--   pro      roles → gemini-3-flash-preview        ($0.50/$3.00)  (unchanged)
--
-- Estimated daily savings: ~$40-45 (from ~$68 → ~$20-25)

-- ── Economy tier ($0.10 / $0.40 per 1M tokens) ──────────────
UPDATE company_agents
SET model = 'gemini-2.5-flash-lite', updated_at = NOW()
WHERE role IN ('m365-admin', 'global-admin', 'seo-analyst', 'social-media-manager', 'adi-rose');

-- ── Standard tier ($0.25 / $1.50 per 1M tokens) ─────────────
UPDATE company_agents
SET model = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE role IN (
  'content-creator', 'design-critic', 'ui-ux-designer', 'frontend-engineer',
  'template-architect', 'user-researcher', 'competitive-intel',
  'devops-engineer', 'platform-engineer', 'quality-engineer',
  'head-of-hr', 'vp-sales', 'vp-design', 'vp-customer-success',
  'bob-the-tax-pro', 'marketing-intelligence-analyst',
  'competitive-research-analyst', 'market-research-analyst',
  'technical-research-analyst', 'industry-research-analyst',
  'onboarding-specialist', 'support-triage', 'account-research',
  'revenue-analyst', 'cost-analyst', 'platform-intel'
);

-- Pro tier roles already on gemini-3-flash-preview — no change needed:
-- chief-of-staff, cto, cfo, cpo, cmo, clo, vp-research, ops
