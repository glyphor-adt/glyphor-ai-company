-- Remove gemini-2.5-pro from model_registry after clearing FK references from routing_config.
-- Code no longer treats this slug as a supported model; routing is canonicalized at runtime,
-- but deleting the row prevents stale DB seeds from reintroducing it as a selectable FK target.

BEGIN;

UPDATE routing_config
SET
  model_slug = 'gemini-3.1-flash-lite-preview',
  description = COALESCE(description, '') || ' [FK cleanup: removed gemini-2.5-pro]',
  updated_at = NOW()
WHERE model_slug = 'gemini-2.5-pro';

UPDATE company_agents
SET
  model = 'gemini-3.1-flash-lite-preview',
  updated_at = NOW()
WHERE model = 'gemini-2.5-pro';

DELETE FROM model_registry WHERE slug = 'gemini-2.5-pro';

COMMIT;
