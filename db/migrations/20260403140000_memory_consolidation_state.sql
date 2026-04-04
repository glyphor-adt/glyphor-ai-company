-- Auto-dream v1 (Glyphor): single-row state for scheduled memory consolidation.
-- Gates + lease are enforced in the scheduler; this table stores last success and lease columns.

CREATE TABLE IF NOT EXISTS memory_consolidation_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  last_consolidated_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  last_attempt_at TIMESTAMPTZ,
  lease_holder TEXT,
  lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO memory_consolidation_state (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE memory_consolidation_state IS 'Tracks fleet memory consolidation (auto-dream v1): last run, lease for single-flight cron.';
