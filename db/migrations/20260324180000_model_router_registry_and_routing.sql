-- Microsoft Foundry model-router: register slug and point general workload routes at it.
-- Chat Completions API; deployment name should match slug (e.g. model-router).
-- https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/model-router

INSERT INTO model_registry (
  slug, provider, tier, display_name, input_cost_per_m, output_cost_per_m,
  context_window, max_output, supports_tools, supports_vision, supports_thinking, is_preview, is_active
) VALUES (
  'model-router',
  'openai',
  'workhorse',
  'Model Router (Foundry)',
  0.75,
  4.50,
  200000,
  128000,
  true,
  true,
  true,
  false,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  tier = EXCLUDED.tier,
  input_cost_per_m = EXCLUDED.input_cost_per_m,
  output_cost_per_m = EXCLUDED.output_cost_per_m,
  context_window = EXCLUDED.context_window,
  max_output = EXCLUDED.max_output,
  supports_tools = EXCLUDED.supports_tools,
  supports_vision = EXCLUDED.supports_vision,
  supports_thinking = EXCLUDED.supports_thinking,
  is_preview = EXCLUDED.is_preview,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

UPDATE routing_config SET model_slug = 'model-router', updated_at = NOW()
WHERE route_name IN (
  'workhorse',
  'orchestration',
  'executive_assignment',
  'visual_analysis',
  'code_gen',
  'founder_chat',
  'default'
);

UPDATE company_agents SET model = 'model-router', updated_at = NOW()
WHERE model = 'gpt-5.4-mini';
