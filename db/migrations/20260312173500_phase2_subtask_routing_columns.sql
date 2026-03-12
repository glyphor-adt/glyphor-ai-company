ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_routing_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS subtask_complexity TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_subtask_complexity
  ON agent_runs (subtask_complexity)
  WHERE subtask_complexity IS NOT NULL;

COMMENT ON COLUMN agent_runs.model_routing_reason IS 'Human-readable explanation for the routed model choice.';
COMMENT ON COLUMN agent_runs.subtask_complexity IS 'Highest subtask complexity observed during the run.';
