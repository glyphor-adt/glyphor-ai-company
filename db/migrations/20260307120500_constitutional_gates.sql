-- Constitutional gate event log — records every pre-execution principle check
-- for audit trail and trust scoring.

CREATE TABLE IF NOT EXISTS constitutional_gate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  check_phase TEXT NOT NULL,  -- 'deterministic' | 'principle_llm'
  result TEXT NOT NULL,        -- 'passed' | 'warned' | 'blocked'
  violations JSONB,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_constitutional_gates_agent ON constitutional_gate_events(agent_role);
CREATE INDEX idx_constitutional_gates_result ON constitutional_gate_events(result);
