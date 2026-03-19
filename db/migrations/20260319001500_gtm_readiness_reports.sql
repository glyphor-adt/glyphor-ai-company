-- GTM Readiness Reports — persists pass/fail snapshots for Marketing Department GTM gate
CREATE TABLE IF NOT EXISTS gtm_readiness_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overall TEXT NOT NULL CHECK (overall IN ('READY', 'NOT_READY', 'INSUFFICIENT_DATA')),
  marketing_department_ready BOOLEAN NOT NULL,
  report_json JSONB NOT NULL,
  passing_count INTEGER NOT NULL,
  failing_count INTEGER NOT NULL,
  insufficient_data_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gtm_reports_generated ON gtm_readiness_reports(generated_at DESC);
