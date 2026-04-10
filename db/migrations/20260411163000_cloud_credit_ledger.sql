-- Ledger of estimated model usage cost per cloud (for credit-aware routing).

CREATE TABLE IF NOT EXISTS cloud_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud text NOT NULL CHECK (cloud IN ('aws', 'azure', 'gcp')),
  model_id text NOT NULL,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  est_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  called_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid
);

CREATE INDEX IF NOT EXISTS cloud_credit_ledger_cloud_called_at_idx
  ON cloud_credit_ledger (cloud, called_at DESC);
