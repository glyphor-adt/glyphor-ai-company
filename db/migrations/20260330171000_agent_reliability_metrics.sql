BEGIN;

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS thinking_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_activity_log_agent_created
  ON activity_log (agent_role, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_metrics_cache (
  agent_id TEXT NOT NULL,
  window_days INTEGER NOT NULL CHECK (window_days > 0),
  metrics JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, window_days)
);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_cache_computed_at
  ON agent_metrics_cache (computed_at DESC);

CREATE TABLE IF NOT EXISTS action_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_log_id UUID NOT NULL REFERENCES activity_log(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  reversal_reason TEXT NOT NULL,
  reversed_by TEXT NOT NULL,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_reversals_agent_reversed
  ON action_reversals (agent_id, reversed_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_reversals_audit_log
  ON action_reversals (audit_log_id);

CREATE OR REPLACE FUNCTION invalidate_agent_metrics_cache_from_activity_log()
RETURNS trigger AS $$
BEGIN
  DELETE FROM agent_metrics_cache
  WHERE agent_id IN (NEW.agent_id, NEW.agent_role);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invalidate_agent_metrics_cache_from_activity_log ON activity_log;

CREATE TRIGGER trg_invalidate_agent_metrics_cache_from_activity_log
AFTER INSERT ON activity_log
FOR EACH ROW
EXECUTE FUNCTION invalidate_agent_metrics_cache_from_activity_log();

COMMIT;