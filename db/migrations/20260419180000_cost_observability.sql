-- ============================================================================
-- Cost observability: model_rate_card + v_agent_run_cost_breakdown
-- Added 2026-04-19 after reconciling reported $423/day vs actual ~$159/day
-- from GCP $71.68 + Azure $27.26 + AWS $60.
--
-- Key fix: rates live in a table, not hard-coded in modelRates.ts. This lets
-- us calibrate per model against actual provider bills without redeploying.
--
-- Cache math mirrors packages/shared/src/models.ts::estimateModelCost:
--   uncached_input = max(input_tokens - cached_input_tokens, 0)
--   input_cost = (uncached_input * input_rate + cached_input_tokens * input_rate * cache_discount) / 1e6
--   output_cost = output_tokens * output_rate / 1e6
--   thinking_cost = thinking_tokens * (thinking_rate || output_rate) / 1e6
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS model_rate_card (
  model_id              TEXT         PRIMARY KEY,
  provider              TEXT         NOT NULL,       -- 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'unknown'
  cloud                 TEXT,                        -- 'gcp' | 'aws' | 'azure' | NULL (direct API)
  input_per_1m_usd      NUMERIC(10,4) NOT NULL,
  output_per_1m_usd     NUMERIC(10,4) NOT NULL,
  thinking_per_1m_usd   NUMERIC(10,4),                -- fallback to output_per_1m_usd when NULL
  cache_discount        NUMERIC(5,4)  NOT NULL DEFAULT 1.0, -- 0.10 = 10% of input rate
  effective_from        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  source                TEXT,                         -- e.g. 'vertex-pricing-2026-04', 'reconciled-2026-04-19'
  notes                 TEXT,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_rate_card_cloud ON model_rate_card(cloud);
CREATE INDEX IF NOT EXISTS idx_model_rate_card_provider ON model_rate_card(provider);

-- Seed from SUPPORTED_MODELS in packages/shared/src/models.ts
-- Rates are the POSTED vendor prices. We'll calibrate against provider bills.
-- For Gemini preview, using Google's published Vertex pricing for 3.1 Pro/Flash-Lite.
INSERT INTO model_rate_card (model_id, provider, cloud, input_per_1m_usd, output_per_1m_usd, thinking_per_1m_usd, cache_discount, source) VALUES
  -- Anthropic (routed via AWS Bedrock per routing/resolveModel.ts)
  ('claude-opus-4-7',                'anthropic', 'aws',   15.00,  75.00,  NULL,   0.10, 'anthropic-list-2026-04'),
  ('claude-sonnet-4-6',              'anthropic', 'aws',    3.00,  15.00,  NULL,   0.10, 'anthropic-list-2026-04'),
  ('claude-sonnet-4-5',              'anthropic', 'aws',    3.00,  15.00,  NULL,   0.10, 'anthropic-list-2026-04'),
  ('claude-haiku-4-5',               'anthropic', 'aws',    1.00,   5.00,  NULL,   0.10, 'anthropic-list-2026-04'),
  -- OpenAI (routed via Azure OpenAI per routing/resolveModel.ts)
  ('gpt-5.4',                        'openai',    'azure',  2.50,  15.00,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5.4-mini',                   'openai',    'azure',  0.75,   4.50,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5.4-nano',                   'openai',    'azure',  0.20,   1.25,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5.2',                        'openai',    'azure',  1.75,  14.00,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5.1',                        'openai',    'azure',  1.25,  10.00,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5',                          'openai',    'azure',  1.25,  10.00,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5-mini',                     'openai',    'azure',  0.25,   2.00,  NULL,   0.10, 'openai-list-2026-04'),
  ('gpt-5-nano',                     'openai',    'azure',  0.05,   0.40,  NULL,   0.10, 'openai-list-2026-04'),
  ('o3',                             'openai',    'azure',  2.00,   8.00,  8.00,   0.10, 'openai-list-2026-04'),
  ('o4-mini',                        'openai',    'azure',  1.10,   4.40,  4.40,   0.10, 'openai-list-2026-04'),
  ('model-router',                   'openai',    'azure',  0.75,   4.50,  NULL,   0.10, 'openai-list-2026-04'),
  -- Gemini (GCP Vertex AI) — rates NEED CALIBRATION against gcp_billing gemini-api line
  -- Google public Vertex Gemini 3.1 Pro: $2.50 in / $15 out per 1M (up to 128k context)
  -- Google public Vertex Gemini 3.1 Flash-Lite: $0.10 in / $0.40 out per 1M
  ('gemini-3.1-pro-preview',         'gemini',    'gcp',    2.50,  15.00,  15.00,  0.25, 'vertex-list-2026-04'),
  ('gemini-3.1-flash-lite-preview',  'gemini',    'gcp',    0.10,   0.40,   0.40,  0.25, 'vertex-list-2026-04'),
  ('gemini-3-flash-preview',         'gemini',    'gcp',    1.25,   5.00,   5.00,  0.25, 'vertex-list-2026-04'),
  ('gemini-3.1-pro',                 'gemini',    'gcp',    2.50,  15.00,  15.00,  0.25, 'vertex-list-2026-04'),
  ('gemini-3.1-flash-lite',          'gemini',    'gcp',    0.10,   0.40,   0.40,  0.25, 'vertex-list-2026-04'),
  ('gemini-3-flash',                 'gemini',    'gcp',    1.25,   5.00,   5.00,  0.25, 'vertex-list-2026-04'),
  ('gemini-2.5-pro',                 'gemini',    'gcp',    1.25,  10.00,  10.00,  0.25, 'vertex-list-2026-04'),
  ('gemini-2.5-flash',               'gemini',    'gcp',    0.15,   0.60,   0.60,  0.25, 'vertex-list-2026-04'),
  ('gemini-2.5-flash-lite',          'gemini',    'gcp',    0.075,  0.30,   0.30,  0.25, 'vertex-list-2026-04'),
  -- DeepSeek (direct API, not one of the hyperscalers)
  ('deepseek-v3-2',                  'deepseek',  NULL,     0.27,   1.10,   NULL,  0.25, 'deepseek-list-2026-04')
ON CONFLICT (model_id) DO UPDATE SET
  provider            = EXCLUDED.provider,
  cloud               = EXCLUDED.cloud,
  input_per_1m_usd    = EXCLUDED.input_per_1m_usd,
  output_per_1m_usd   = EXCLUDED.output_per_1m_usd,
  thinking_per_1m_usd = EXCLUDED.thinking_per_1m_usd,
  cache_discount      = EXCLUDED.cache_discount,
  source              = EXCLUDED.source,
  updated_at          = NOW();

-- Per-run breakdown with cache-aware math.
CREATE OR REPLACE VIEW v_agent_run_cost_breakdown AS
WITH resolved AS (
  SELECT r.*,
         COALESCE(r.actual_model, r.model_used, r.routing_model) AS resolved_model
    FROM agent_runs r
)
SELECT
  r.id                                                                  AS run_id,
  r.agent_id,
  r.started_at,
  r.resolved_model                                                      AS model,
  COALESCE(rc.provider, 'unknown')                                      AS provider,
  COALESCE(rc.cloud,    'unknown')                                      AS cloud,
  COALESCE(r.input_tokens,        0)::bigint                            AS input_tokens,
  COALESCE(r.cached_input_tokens, 0)::bigint                            AS cached_input_tokens,
  COALESCE(r.output_tokens,       0)::bigint                            AS output_tokens,
  COALESCE(r.thinking_tokens,     0)::bigint                            AS thinking_tokens,
  GREATEST(COALESCE(r.input_tokens,0) - COALESCE(r.cached_input_tokens,0), 0)::bigint AS uncached_input_tokens,
  rc.input_per_1m_usd,
  rc.output_per_1m_usd,
  COALESCE(rc.thinking_per_1m_usd, rc.output_per_1m_usd)                AS thinking_per_1m_usd,
  rc.cache_discount,
  -- Cost components (NULL when we don't have a rate for the resolved model)
  CASE WHEN rc.input_per_1m_usd IS NULL THEN NULL ELSE
    (GREATEST(COALESCE(r.input_tokens,0) - COALESCE(r.cached_input_tokens,0), 0)::numeric * rc.input_per_1m_usd / 1e6)
    + (COALESCE(r.cached_input_tokens,0)::numeric * rc.input_per_1m_usd * rc.cache_discount / 1e6)
  END                                                                   AS input_cost_usd,
  CASE WHEN rc.output_per_1m_usd IS NULL THEN NULL ELSE
    (COALESCE(r.output_tokens,0)::numeric * rc.output_per_1m_usd / 1e6)
  END                                                                   AS output_cost_usd,
  CASE WHEN rc.output_per_1m_usd IS NULL THEN NULL ELSE
    (COALESCE(r.thinking_tokens,0)::numeric * COALESCE(rc.thinking_per_1m_usd, rc.output_per_1m_usd) / 1e6)
  END                                                                   AS thinking_cost_usd,
  -- Total computed cost (cache-aware)
  CASE WHEN rc.input_per_1m_usd IS NULL THEN NULL ELSE
      (GREATEST(COALESCE(r.input_tokens,0) - COALESCE(r.cached_input_tokens,0), 0)::numeric * rc.input_per_1m_usd / 1e6)
    + (COALESCE(r.cached_input_tokens,0)::numeric * rc.input_per_1m_usd * rc.cache_discount / 1e6)
    + (COALESCE(r.output_tokens,0)::numeric * rc.output_per_1m_usd / 1e6)
    + (COALESCE(r.thinking_tokens,0)::numeric * COALESCE(rc.thinking_per_1m_usd, rc.output_per_1m_usd) / 1e6)
  END                                                                   AS computed_cost_usd,
  r.total_cost_usd                                                      AS reported_cost_usd,
  r.total_cost_usd
    - CASE WHEN rc.input_per_1m_usd IS NULL THEN 0 ELSE
          (GREATEST(COALESCE(r.input_tokens,0) - COALESCE(r.cached_input_tokens,0), 0)::numeric * rc.input_per_1m_usd / 1e6)
        + (COALESCE(r.cached_input_tokens,0)::numeric * rc.input_per_1m_usd * rc.cache_discount / 1e6)
        + (COALESCE(r.output_tokens,0)::numeric * rc.output_per_1m_usd / 1e6)
        + (COALESCE(r.thinking_tokens,0)::numeric * COALESCE(rc.thinking_per_1m_usd, rc.output_per_1m_usd) / 1e6)
      END                                                               AS overreport_usd
FROM resolved r
LEFT JOIN model_rate_card rc ON rc.model_id = r.resolved_model;

-- Daily per-agent-per-model rollup.
CREATE OR REPLACE VIEW v_agent_daily_cost AS
SELECT
  (started_at AT TIME ZONE 'America/Chicago')::date  AS run_date_ct,
  agent_id,
  model,
  provider,
  cloud,
  COUNT(*)::int                                      AS runs,
  SUM(input_tokens)::bigint                          AS input_tokens,
  SUM(cached_input_tokens)::bigint                   AS cached_input_tokens,
  SUM(output_tokens)::bigint                         AS output_tokens,
  SUM(thinking_tokens)::bigint                       AS thinking_tokens,
  ROUND(SUM(computed_cost_usd)::numeric,  4)         AS computed_cost_usd,
  ROUND(SUM(reported_cost_usd)::numeric,  4)         AS reported_cost_usd,
  ROUND(SUM(overreport_usd)::numeric,     4)         AS overreport_usd
FROM v_agent_run_cost_breakdown
GROUP BY 1, 2, 3, 4, 5;

-- Daily per-cloud rollup to line up against provider bills.
CREATE OR REPLACE VIEW v_cloud_daily_internal_cost AS
SELECT
  run_date_ct,
  cloud,
  ROUND(SUM(computed_cost_usd)::numeric, 4) AS computed_cost_usd,
  ROUND(SUM(reported_cost_usd)::numeric, 4) AS reported_cost_usd
FROM v_agent_daily_cost
GROUP BY 1, 2;

COMMIT;
