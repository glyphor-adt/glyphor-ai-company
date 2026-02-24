-- Add GCP project column to gcp_billing for per-project cost tracking
ALTER TABLE gcp_billing ADD COLUMN IF NOT EXISTS project TEXT;
CREATE INDEX IF NOT EXISTS idx_gcp_billing_project ON gcp_billing(project);
