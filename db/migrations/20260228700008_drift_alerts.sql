-- ═══════════════════════════════════════════════════════════════
-- Enhancement 8: Semantic Drift Detection — Drift Alerts
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS drift_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  metric TEXT NOT NULL,
  baseline_value FLOAT NOT NULL,
  recent_value FLOAT NOT NULL,
  deviation_sigma FLOAT NOT NULL,
  direction TEXT NOT NULL, -- 'degraded' | 'improved'
  severity TEXT NOT NULL,  -- 'info' | 'warning' | 'critical'
  acknowledged BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drift_active ON drift_alerts(acknowledged, severity)
  WHERE acknowledged = FALSE;

ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
