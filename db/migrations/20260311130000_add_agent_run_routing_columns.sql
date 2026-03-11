ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_rule TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_capabilities TEXT[];
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS routing_model TEXT;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'aborted', 'skipped_precheck'));

CREATE INDEX IF NOT EXISTS idx_agent_runs_routing_model
  ON agent_runs (routing_model)
  WHERE routing_model IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_routing_rule
  ON agent_runs (routing_rule)
  WHERE routing_rule IS NOT NULL;

COMMENT ON COLUMN agent_runs.routing_rule IS 'Routing rule selected for the run.';
COMMENT ON COLUMN agent_runs.routing_capabilities IS 'Capabilities inferred by the LLM router.';
COMMENT ON COLUMN agent_runs.routing_model IS 'Actual routed model used for the run.';
