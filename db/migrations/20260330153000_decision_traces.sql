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

CREATE INDEX IF NOT EXISTS idx_decision_traces_agent_created
  ON decision_traces (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_traces_task_created
  ON decision_traces (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_traces_confidence
  ON decision_traces (confidence_at_decision DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_decision_traces_contract
  ON decision_traces (handoff_contract_id, created_at DESC);

COMMIT;