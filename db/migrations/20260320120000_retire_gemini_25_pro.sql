-- Retire gemini-2.5-pro from all routing and agent assignments.
-- Replacement: gemini-3.1-pro-preview (same provider, newer, cheaper).

BEGIN;

-- 1. Update routing_config rows still pointing to gemini-2.5-pro
UPDATE routing_config
SET model_slug  = 'gemini-3-flash-preview',
    description = description || ' [migrated from gemini-2.5-pro 2026-03-20]',
    updated_at  = NOW()
WHERE model_slug = 'gemini-2.5-pro';

-- 2. Update any company_agents still on gemini-2.5-pro
UPDATE company_agents
SET model      = 'gemini-3.1-flash-lite-preview',
    updated_at = NOW()
WHERE model = 'gemini-2.5-pro';

-- 3. Mark as retired in model_registry (if table exists)
UPDATE model_registry
SET is_active   = false,
    deprecated_at = NOW(),
    updated_at  = NOW()
WHERE slug = 'gemini-2.5-pro';

COMMIT;
