-- Clear explicit model overrides so ROLE_COST_TIER routing takes effect
-- ═══════════════════════════════════════════════════════════════════
--
-- Problem: Every agent in company_agents has model = 'gemini-3-flash-preview'
-- (the pro tier at $0.50/$3.00 per 1M tokens). This defeats the cost
-- optimizer in optimizeModel() which maps roles to economy/standard/pro
-- tiers automatically.
--
-- After this migration:
--   economy  roles → gemini-2.5-flash-lite        ($0.10/$0.40)
--   standard roles → gemini-3.1-flash-lite-preview ($0.25/$1.50)
--   pro      roles → gemini-3-flash-preview        ($0.50/$3.00)
--
-- Estimated daily savings: ~$40-45 (from ~$68 → ~$20-25)

-- NULL the model column so optimizeModel() uses ROLE_COST_TIER mapping
UPDATE company_agents
SET model = NULL, updated_at = NOW()
WHERE model IS NOT NULL;
