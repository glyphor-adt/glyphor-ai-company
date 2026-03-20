-- Retire gemini-3-flash-preview from pro-tier executives
-- ═══════════════════════════════════════════════════════════════════
--
-- Problem: Pro-tier executives (chief-of-staff, cto, cfo, cpo, cmo,
-- clo, vp-research, ops) are still on gemini-3-flash-preview
-- ($0.50/$3.00 per 1M tokens). This model is 2× the cost of
-- gemini-3.1-flash-lite-preview for no meaningful quality gain
-- on work_loop tasks.
--
-- After this migration: all agents use gemini-3.1-flash-lite-preview
-- ($0.25/$1.50) as their DB model. The routing layer still upgrades
-- to heavier models (gpt-5.4, claude-opus-4-6) for complex_research,
-- deep_research, and triangulation — those routes are unchanged.

UPDATE company_agents
SET model = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE model = 'gemini-3-flash-preview';

-- Also update the routing_config table if it exists
UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE route_name IN ('executive_assignment', 'founder_chat')
  AND model_slug = 'gemini-3-flash-preview';
