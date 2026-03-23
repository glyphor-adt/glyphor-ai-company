-- gcp_create_secret: mark as code-backed static tool; clear empty api_config

ALTER TABLE tool_registry ADD COLUMN IF NOT EXISTS implementation_type TEXT;
ALTER TABLE tool_registry ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE tool_registry
SET api_config = NULL,
    implementation_type = 'static',
    notes = 'Implemented in packages/agents/src/cto/tools.ts',
    updated_at = NOW()
WHERE name = 'gcp_create_secret';
