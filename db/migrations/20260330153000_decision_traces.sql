BEGIN;

CREATE TABLE IF NOT EXISTS decision_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_log_id UUID NOT NULL UNIQUE REFERENCES activity_log(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  react_iterations JSONB NOT NULL DEFAULT '[]'::jsonb,
  self_critique_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  t1_simulation_result JSONB,
  value_analysis_result JSONB,
  alternatives_rejected JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_at_decision DOUBLE PRECISION,
  handoff_contract_id UUID REFERENCES agent_handoff_contracts(id) ON DELETE SET NULL,
  abac_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_decision_summary TEXT,
  nl_explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE decision_traces
  ADD COLUMN IF NOT EXISTS audit_log_id UUID REFERENCES activity_log(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_id TEXT,
  ADD COLUMN IF NOT EXISTS task_id TEXT,
  ADD COLUMN IF NOT EXISTS react_iterations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS self_critique_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS t1_simulation_result JSONB,
  ADD COLUMN IF NOT EXISTS value_analysis_result JSONB,
  ADD COLUMN IF NOT EXISTS alternatives_rejected JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_at_decision DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS handoff_contract_id UUID REFERENCES agent_handoff_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS abac_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_decision_summary TEXT,
  ADD COLUMN IF NOT EXISTS nl_explanation TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE decision_traces
  ALTER COLUMN react_iterations SET DEFAULT '[]'::jsonb,
  ALTER COLUMN self_critique_output SET DEFAULT '{}'::jsonb,
  ALTER COLUMN alternatives_rejected SET DEFAULT '[]'::jsonb,
  ALTER COLUMN abac_decisions SET DEFAULT '[]'::jsonb;

UPDATE decision_traces
SET agent_id = COALESCE(agent_id, actor_id, 'unknown')
WHERE agent_id IS NULL;

UPDATE decision_traces
SET task_id = COALESCE(task_id, contradiction_id::text, id::text)
WHERE task_id IS NULL;

UPDATE decision_traces
SET react_iterations = '[]'::jsonb
WHERE react_iterations IS NULL;

UPDATE decision_traces
SET self_critique_output = '{}'::jsonb
WHERE self_critique_output IS NULL;

UPDATE decision_traces
SET alternatives_rejected = '[]'::jsonb
WHERE alternatives_rejected IS NULL;

UPDATE decision_traces
SET abac_decisions = '[]'::jsonb
WHERE abac_decisions IS NULL;

ALTER TABLE decision_traces
  ALTER COLUMN agent_id SET NOT NULL,
  ALTER COLUMN task_id SET NOT NULL,
  ALTER COLUMN react_iterations SET NOT NULL,
  ALTER COLUMN self_critique_output SET NOT NULL,
  ALTER COLUMN alternatives_rejected SET NOT NULL,
  ALTER COLUMN abac_decisions SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_traces_audit_log_unique
  ON decision_traces (audit_log_id)
  WHERE audit_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decision_traces_agent_created
  ON decision_traces (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_traces_task_created
  ON decision_traces (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_traces_confidence
  ON decision_traces (confidence_at_decision DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_decision_traces_contract
  ON decision_traces (handoff_contract_id, created_at DESC);

COMMIT;