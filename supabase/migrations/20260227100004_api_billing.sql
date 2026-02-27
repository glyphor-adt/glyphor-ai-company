-- External API billing (OpenAI, Anthropic, Kling, etc.)
-- Mirrors gcp_billing structure but adds provider + product columns
CREATE TABLE IF NOT EXISTS api_billing (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,             -- openai, anthropic, kling
  service     TEXT NOT NULL,             -- gpt-4o, claude-sonnet-4-20250514, kling-video, etc.
  cost_usd    DECIMAL(10,4) NOT NULL,
  usage       JSONB DEFAULT '{}',        -- tokens, requests, seconds, etc.
  product     TEXT,                       -- pulse, fuse, glyphor-ai-company, etc.
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_billing_provider  ON api_billing(provider);
CREATE INDEX IF NOT EXISTS idx_api_billing_service   ON api_billing(service);
CREATE INDEX IF NOT EXISTS idx_api_billing_product   ON api_billing(product);
CREATE INDEX IF NOT EXISTS idx_api_billing_recorded  ON api_billing(recorded_at DESC);

-- Ensure data_sync_status rows exist for the new providers
INSERT INTO data_sync_status (id, status, updated_at)
VALUES
  ('openai-billing', 'unknown', NOW()),
  ('anthropic-billing', 'unknown', NOW()),
  ('kling-billing', 'unknown', NOW())
ON CONFLICT (id) DO NOTHING;
