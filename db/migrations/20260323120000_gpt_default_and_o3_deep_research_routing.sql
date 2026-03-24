-- Switch default routing to GPT-5.4 Mini; deep_research route to o3-deep-research (Azure AI Foundry / OpenAI).
-- See: https://learn.microsoft.com/en-us/azure/foundry-classic/agents/how-to/tools-classic/deep-research

INSERT INTO model_registry (
  slug, provider, tier, display_name, input_cost_per_m, output_cost_per_m,
  context_window, max_output, supports_tools, supports_vision, supports_thinking, is_preview, is_active
) VALUES (
  'o3-deep-research',
  'openai',
  'specialist',
  'o3 Deep Research',
  2.00,
  8.00,
  200000,
  65536,
  true,
  false,
  true,
  false,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
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

UPDATE routing_config SET model_slug = 'gpt-5.4-nano', updated_at = NOW() WHERE route_name = 'economy';

UPDATE routing_config SET model_slug = 'gpt-5.4-mini', updated_at = NOW()
WHERE route_name IN (
  'workhorse',
  'orchestration',
  'executive_assignment',
  'visual_analysis',
  'code_gen',
  'founder_chat',
  'default'
);

UPDATE routing_config SET model_slug = 'o3-deep-research', updated_at = NOW() WHERE route_name = 'deep_research';

UPDATE company_agents SET model = 'gpt-5.4-mini', updated_at = NOW()
WHERE model IN (
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview'
);
