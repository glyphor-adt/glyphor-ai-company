-- Retire deprecated Gemini models from live DB data.
-- Models being retired:
--   gemini-2.5-flash      → gemini-3.1-flash-lite-preview
--   gemini-2.5-flash-lite → gemini-3.1-flash-lite-preview
--   gemini-2.5-pro        → gemini-3.1-pro-preview
--   gemini-3-flash-preview → gemini-3.1-flash-lite-preview

-- 1. company_agents — update any agent still assigned to a retired model
UPDATE company_agents SET model = 'gemini-3.1-flash-lite-preview', updated_at = NOW()
WHERE model IN ('gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview');

UPDATE company_agents SET model = 'gemini-3.1-pro-preview', updated_at = NOW()
WHERE model = 'gemini-2.5-pro';

-- 2. reasoning_config — update verification_models arrays
UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'),
    updated_at = NOW()
WHERE 'gemini-2.5-flash-lite' = ANY(verification_models);

UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'),
    updated_at = NOW()
WHERE 'gemini-2.5-flash' = ANY(verification_models);

UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gemini-2.5-pro', 'gemini-3.1-pro-preview'),
    updated_at = NOW()
WHERE 'gemini-2.5-pro' = ANY(verification_models);

UPDATE reasoning_config
SET verification_models = array_replace(verification_models, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'),
    updated_at = NOW()
WHERE 'gemini-3-flash-preview' = ANY(verification_models);

-- 3. Update default on verification_models column
ALTER TABLE reasoning_config
  ALTER COLUMN verification_models SET DEFAULT '{gemini-3.1-flash-lite-preview}';
