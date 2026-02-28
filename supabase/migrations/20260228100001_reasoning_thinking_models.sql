-- ═══════════════════════════════════════════════════════════════
-- Update verification models to thinking-enabled models
-- gemini-3-flash-preview, gpt-5.2-2025-12-11, claude-opus-4-6
-- ═══════════════════════════════════════════════════════════════

-- Update column default
ALTER TABLE agent_reasoning_config
  ALTER COLUMN verification_models SET DEFAULT '{gemini-3-flash-preview}';

-- Update all existing rows that still reference legacy models
UPDATE agent_reasoning_config
SET verification_models = '{gemini-3-flash-preview}',
    updated_at = now()
WHERE verification_models = '{gemini-2.5-flash-lite}';

UPDATE agent_reasoning_config
SET verification_models = '{gemini-3-flash-preview,gpt-5.2-2025-12-11}',
    updated_at = now()
WHERE verification_models = '{gemini-2.5-flash-lite,gpt-4.1-mini}';

-- Enable cross-model on chief-of-staff and cto with all 3 thinking models
UPDATE agent_reasoning_config
SET cross_model_enabled = true,
    verification_models = '{gemini-3-flash-preview,gpt-5.2-2025-12-11,claude-opus-4-6}',
    updated_at = now()
WHERE agent_role IN ('chief-of-staff', 'cto');

-- Ensure clo and vp-research also get all 3 thinking models
UPDATE agent_reasoning_config
SET verification_models = '{gemini-3-flash-preview,gpt-5.2-2025-12-11,claude-opus-4-6}',
    updated_at = now()
WHERE agent_role IN ('clo', 'vp-research');
