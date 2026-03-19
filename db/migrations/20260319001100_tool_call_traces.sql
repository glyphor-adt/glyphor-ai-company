-- Tool call traces — persists the in-memory ToolCallLog[] from toolExecutor.ts
-- so every tool invocation is queryable for accuracy evaluation and retrieval analytics.

CREATE TABLE IF NOT EXISTS tool_call_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES work_assignments(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args JSONB,
  result_success BOOLEAN NOT NULL,
  result_data JSONB,
  result_error TEXT,
  files_written INTEGER DEFAULT 0,
  memory_keys_written INTEGER DEFAULT 0,
  constitutional_check JSONB,
  estimated_cost_usd NUMERIC(10,6),
  turn_number INTEGER,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Retrieval metadata (from ToolRetriever)
  retrieval_method TEXT,         -- 'role_pin' | 'core_pin' | 'dept_pin' | 'semantic'
  retrieval_score NUMERIC,       -- hybrid score from BM25+vector if semantic
  tools_available INTEGER,       -- how many tools were in the agent's context this run
  model_cap INTEGER              -- cap used for this run (20-128)
);

CREATE INDEX idx_tct_run_id ON tool_call_traces(run_id);
CREATE INDEX idx_tct_agent_id ON tool_call_traces(agent_id);
CREATE INDEX idx_tct_tool_name ON tool_call_traces(tool_name);
CREATE INDEX idx_tct_called_at ON tool_call_traces(called_at DESC);
CREATE INDEX idx_tct_result_success ON tool_call_traces(result_success);
