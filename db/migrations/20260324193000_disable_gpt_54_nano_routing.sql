-- Stop routing economy traffic to gpt-5.4-nano and migrate existing assignments.
-- Context: direct gpt-5.4-nano calls can fail with OpenAI quota errors when Foundry routing is expected.

UPDATE routing_config
SET model_slug = 'model-router', updated_at = NOW()
WHERE route_name = 'economy' AND model_slug = 'gpt-5.4-nano';

UPDATE company_agents
SET model = 'model-router', updated_at = NOW()
WHERE model = 'gpt-5.4-nano';

UPDATE model_registry
SET is_active = false, updated_at = NOW()
WHERE slug = 'gpt-5.4-nano';
