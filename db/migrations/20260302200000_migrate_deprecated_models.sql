-- Migrate agents from deprecated models to current supported models.
-- This catches agents like Adi Rose that are stuck on gemini-2.0-flash-001
-- or any other legacy model ID no longer in service.

-- Gemini 2.x and older → current equivalents
UPDATE company_agents SET model = 'gemini-2.5-flash', updated_at = NOW()
WHERE model IN ('gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash');

UPDATE company_agents SET model = 'gemini-2.5-pro', updated_at = NOW()
WHERE model IN ('gemini-2.0-pro', 'gemini-1.5-pro');

-- Fix version typo: gemini-3.0-flash-preview → gemini-3-flash-preview
UPDATE company_agents SET model = 'gemini-3-flash-preview', updated_at = NOW()
WHERE model = 'gemini-3.0-flash-preview';

-- OpenAI legacy models
UPDATE company_agents SET model = 'gpt-5-mini', updated_at = NOW()
WHERE model IN ('gpt-4o');

UPDATE company_agents SET model = 'gpt-5-nano', updated_at = NOW()
WHERE model IN ('gpt-4o-mini');

UPDATE company_agents SET model = 'gpt-4.1', updated_at = NOW()
WHERE model IN ('gpt-4-turbo', 'gpt-4');

UPDATE company_agents SET model = 'gpt-4.1-mini', updated_at = NOW()
WHERE model IN ('gpt-3.5-turbo');

-- Anthropic legacy models
UPDATE company_agents SET model = 'claude-sonnet-4-6', updated_at = NOW()
WHERE model IN ('claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest');

UPDATE company_agents SET model = 'claude-haiku-4-5', updated_at = NOW()
WHERE model IN ('claude-3-5-haiku-20241022', 'claude-3-5-haiku-latest', 'claude-3-haiku-20240307');

UPDATE company_agents SET model = 'claude-opus-4-6', updated_at = NOW()
WHERE model IN ('claude-3-opus-20240229', 'claude-opus-4-20250514');

-- Also update verification_models arrays in agent_reasoning_config
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_reasoning_config') THEN
    UPDATE agent_reasoning_config
    SET verification_models = ARRAY['gemini-3-flash-preview', 'gpt-5-mini', 'claude-sonnet-4-6']
    WHERE verification_models IS NOT NULL
      AND (
        verification_models @> ARRAY['gpt-5.2-2025-12-11']
        OR verification_models @> ARRAY['claude-opus-4-6']
        OR verification_models @> ARRAY['claude-sonnet-4-20250514']
      );
  END IF;
END $$;
