-- Retire gpt-4.1, gpt-4.1-mini, claude-haiku-4-5
-- gpt-4.1       → gpt-5-mini-2025-08-07
-- gpt-4.1-mini  → gpt-5-nano
-- claude-haiku-4-5 → claude-sonnet-4-5

BEGIN;

-- Migrate agent model assignments
UPDATE company_agents SET model = 'gpt-5-mini-2025-08-07', updated_at = NOW()
WHERE model = 'gpt-4.1';

UPDATE company_agents SET model = 'gpt-5-nano', updated_at = NOW()
WHERE model = 'gpt-4.1-mini';

UPDATE company_agents SET model = 'claude-sonnet-4-5', updated_at = NOW()
WHERE model = 'claude-haiku-4-5';

-- Migrate reasoning_config verification_models arrays
UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gpt-4.1', 'gpt-5-mini-2025-08-07'),
    updated_at = NOW()
WHERE 'gpt-4.1' = ANY(verification_models);

UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gpt-4.1-mini', 'gpt-5-nano'),
    updated_at = NOW()
WHERE 'gpt-4.1-mini' = ANY(verification_models);

UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'claude-haiku-4-5', 'claude-sonnet-4-5'),
    updated_at = NOW()
WHERE 'claude-haiku-4-5' = ANY(verification_models);

COMMIT;
