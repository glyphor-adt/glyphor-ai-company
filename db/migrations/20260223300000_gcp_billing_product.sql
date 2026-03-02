-- Add product attribution column to gcp_billing
ALTER TABLE gcp_billing ADD COLUMN IF NOT EXISTS product TEXT;
CREATE INDEX IF NOT EXISTS idx_gcp_billing_product ON gcp_billing(product);
