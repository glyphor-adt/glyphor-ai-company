-- Replace Claude Sonnet 4.6 with Gemini 3.1 Flash-Lite (economy default) for cost control.
-- Canonical slug: gemini-3.1-flash-lite-preview (see packages/shared/src/models.config.ts tiers.default).

UPDATE company_agents
SET model = 'gemini-3.1-flash-lite-preview',
    updated_at = NOW()
WHERE model = 'claude-sonnet-4-6';

UPDATE routing_config
SET model_slug = 'gemini-3.1-flash-lite-preview',
    description = 'CLO contract/compliance review. Manual trigger only. (Gemini Flash-Lite — Claude retired for cost.)',
    updated_at = NOW()
WHERE route_name = 'legal_review'
  AND model_slug = 'claude-sonnet-4-6';
