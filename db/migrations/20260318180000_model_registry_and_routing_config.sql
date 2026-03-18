-- Model Registry & Routing Config
-- Hot-swappable model routing: change routing targets via DB without code deploys.
-- model_registry tracks all available models with pricing, capabilities, and deprecation dates.
-- routing_config maps named routes to model slugs with priorities.

-- ─── 1. Model Registry ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS model_registry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic')),
  tier TEXT NOT NULL CHECK (tier IN ('economy', 'workhorse', 'pro', 'specialist')),
  display_name TEXT NOT NULL,
  input_cost_per_m NUMERIC NOT NULL,
  output_cost_per_m NUMERIC NOT NULL,
  context_window INT NOT NULL,
  max_output INT,
  supports_tools BOOLEAN DEFAULT true,
  supports_vision BOOLEAN DEFAULT false,
  supports_thinking BOOLEAN DEFAULT false,
  is_preview BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  deprecated_at TIMESTAMPTZ,
  shutdown_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier);
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry(is_active);

-- ─── 2. Routing Config ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS routing_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_name TEXT UNIQUE NOT NULL,
  model_slug TEXT NOT NULL REFERENCES model_registry(slug),
  description TEXT,
  conditions JSONB,
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_routing_config_active ON routing_config(is_active, priority DESC);

-- ─── 3. Seed Model Registry ─────────────────────────────────

INSERT INTO model_registry (slug, provider, tier, display_name, input_cost_per_m, output_cost_per_m, context_window, max_output, supports_tools, supports_vision, supports_thinking, is_preview) VALUES
  -- Gemini
  ('gemini-2.5-flash-lite',         'gemini',    'economy',    'Gemini 2.5 Flash Lite',    0.10,  0.40,  1000000, 65536,  true,  false, false, false),
  ('gemini-3.1-flash-lite-preview', 'gemini',    'workhorse',  'Gemini 3.1 Flash Lite',    0.25,  1.50,  1000000, 65536,  true,  true,  false, true),
  ('gemini-2.5-flash',              'gemini',    'workhorse',  'Gemini 2.5 Flash',         0.30,  2.50,  1000000, 65536,  true,  true,  true,  false),
  ('gemini-3-flash-preview',        'gemini',    'pro',        'Gemini 3 Flash',           0.50,  3.00,  1000000, 65536,  true,  true,  true,  true),
  ('gemini-2.5-pro',                'gemini',    'pro',        'Gemini 2.5 Pro',           1.25, 10.00,  1000000, 65536,  true,  true,  true,  false),
  ('gemini-3.1-pro-preview',        'gemini',    'pro',        'Gemini 3.1 Pro',           2.00, 12.00,  1000000, 65536,  true,  true,  true,  true),
  -- OpenAI
  ('gpt-5-nano',                    'openai',    'economy',    'GPT-5 Nano',               0.05,  0.40,   400000, 65536,  true,  true,  false, false),
  ('gpt-5.4-nano',                  'openai',    'economy',    'GPT-5.4 Nano',             0.20,  1.25,   400000, 128000, true,  true,  false, false),
  ('gpt-5-mini',                    'openai',    'workhorse',  'GPT-5 Mini',               0.25,  2.00,   400000, 65536,  true,  true,  false, false),
  ('gpt-5.4-mini',                  'openai',    'specialist', 'GPT-5.4 Mini',             0.75,  4.50,   400000, 128000, true,  true,  false, false),
  ('gpt-5.4',                       'openai',    'specialist', 'GPT-5.4',                  2.50, 15.00,  1050000, 128000, true,  true,  true,  false),
  ('o4-mini',                       'openai',    'specialist', 'o4-mini',                  2.00,  8.00,   200000, 65536,  true,  false, true,  false),
  -- Anthropic
  ('claude-haiku-4-5',              'anthropic', 'specialist', 'Claude Haiku 4.5',         1.00,  5.00,   200000, 8192,   true,  false, true,  false),
  ('claude-sonnet-4-6',             'anthropic', 'specialist', 'Claude Sonnet 4.6',        3.00, 15.00,  1000000, 32768,  true,  true,  true,  false),
  ('claude-opus-4-6',               'anthropic', 'specialist', 'Claude Opus 4.6',          5.00, 25.00,  1000000, 32768,  true,  true,  true,  false)
ON CONFLICT (slug) DO UPDATE SET
  input_cost_per_m = EXCLUDED.input_cost_per_m,
  output_cost_per_m = EXCLUDED.output_cost_per_m,
  context_window = EXCLUDED.context_window,
  max_output = EXCLUDED.max_output,
  supports_tools = EXCLUDED.supports_tools,
  supports_vision = EXCLUDED.supports_vision,
  supports_thinking = EXCLUDED.supports_thinking,
  is_preview = EXCLUDED.is_preview,
  updated_at = NOW();

-- ─── 4. Mark Deprecated Models ──────────────────────────────

INSERT INTO model_registry (slug, provider, tier, display_name, input_cost_per_m, output_cost_per_m, context_window, is_active, deprecated_at, shutdown_at, notes) VALUES
  ('gemini-2.0-flash',      'gemini', 'economy', 'Gemini 2.0 Flash (DEPRECATED)',      0, 0, 0, false, '2026-03-01', '2026-06-01', 'Shutdown June 1, 2026. Migrate to gemini-3.1-flash-lite-preview.'),
  ('gemini-2.0-flash-lite', 'gemini', 'economy', 'Gemini 2.0 Flash Lite (DEPRECATED)', 0, 0, 0, false, '2026-03-01', '2026-06-01', 'Shutdown June 1, 2026. Migrate to gemini-2.5-flash-lite.')
ON CONFLICT (slug) DO UPDATE SET
  is_active = false,
  deprecated_at = EXCLUDED.deprecated_at,
  shutdown_at = EXCLUDED.shutdown_at,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ─── 5. Seed Routing Config ─────────────────────────────────

INSERT INTO routing_config (route_name, model_slug, description, priority) VALUES
  ('economy',              'gemini-2.5-flash-lite',          'Tier 0: triage, classification, boolean checks',      100),
  ('workhorse',            'gemini-3.1-flash-lite-preview',  'Tier 1: default for all agents',                       50),
  ('orchestration',        'gemini-2.5-pro',                 'Tier 2: executive orchestration cycles',                90),
  ('executive_assignment', 'gemini-3-flash-preview',         'Tier 2: complex executive assignments',                 80),
  ('complex_research',     'gpt-5.4',                        'Tier 2: deep research, multi-source',                   85),
  ('financial_complex',    'gpt-5.4',                        'Tier 2: complex financial computation',                 85),
  ('visual_analysis',      'gemini-2.5-pro',                 'Tier 2: image/visual understanding',                    85),
  ('code_gen',             'gemini-3.1-flash-lite-preview',  'Tier 1: code generation with tools',                    70),
  ('founder_chat',         'gemini-3-flash-preview',         'Tier 2: on-demand founder interaction',                 75),
  ('triangulation',        'gpt-5.4',                        'Tier 3: cross-provider verification',                   95),
  ('deep_research',        'claude-opus-4-6',               'Founder-flagged deep research. Manual trigger only.',    95),
  ('legal_review',         'claude-sonnet-4-6',             'CLO contract/compliance review. Manual trigger only.',   95),
  ('default',              'gemini-3.1-flash-lite-preview',  'Fallback for unmatched tasks',                           0)
ON CONFLICT (route_name) DO UPDATE SET
  model_slug = EXCLUDED.model_slug,
  description = EXCLUDED.description,
  priority = EXCLUDED.priority,
  updated_at = NOW();

-- ─── 6. RLS Policies ────────────────────────────────────────

DO $$ BEGIN
  -- model_registry: readable by all, writable by system
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'model_registry' AND policyname = 'model_registry_read') THEN
    EXECUTE 'ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY model_registry_read ON model_registry FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY model_registry_write ON model_registry FOR ALL USING (current_setting(''role'') = ''glyphor_system'')';
  END IF;

  -- routing_config: readable by all, writable by system
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'routing_config' AND policyname = 'routing_config_read') THEN
    EXECUTE 'ALTER TABLE routing_config ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY routing_config_read ON routing_config FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY routing_config_write ON routing_config FOR ALL USING (current_setting(''role'') = ''glyphor_system'')';
  END IF;
END $$;
