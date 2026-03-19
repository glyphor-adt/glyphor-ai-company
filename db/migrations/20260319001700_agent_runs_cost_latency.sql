-- Section A: Cost + Latency columns on agent_runs
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS total_input_tokens   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_output_tokens  INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_thinking_tokens INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_tool_cost_usd  NUMERIC(10,6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS llm_cost_usd         NUMERIC(10,6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_cost_usd       NUMERIC(10,6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS model_used           TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cost_source          TEXT DEFAULT 'instrumented';

CREATE INDEX IF NOT EXISTS idx_ar_total_cost ON agent_runs(total_cost_usd) WHERE total_cost_usd IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ar_model_used ON agent_runs(model_used);
