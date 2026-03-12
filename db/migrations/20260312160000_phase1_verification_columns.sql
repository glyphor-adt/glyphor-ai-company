-- Add Phase 1 verification policy metadata columns to agent_runs
ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS verification_tier TEXT;

ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS verification_reason TEXT;

ALTER TABLE IF EXISTS agent_runs
  ADD COLUMN IF NOT EXISTS verification_passes TEXT[];

CREATE INDEX IF NOT EXISTS idx_agent_runs_verification_tier
  ON agent_runs(verification_tier);
