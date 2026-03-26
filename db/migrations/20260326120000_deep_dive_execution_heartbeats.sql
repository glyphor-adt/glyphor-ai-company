-- Add execution lease and heartbeat columns for durable deep dive processing.

ALTER TABLE deep_dives
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deep_dives_last_heartbeat_at
  ON deep_dives (last_heartbeat_at DESC);