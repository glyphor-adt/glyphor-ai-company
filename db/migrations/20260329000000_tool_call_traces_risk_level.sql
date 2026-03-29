-- Add action-risk metadata to tool call traces.

ALTER TABLE tool_call_traces
  ADD COLUMN IF NOT EXISTS risk_level TEXT;

CREATE INDEX IF NOT EXISTS idx_tct_risk_level ON tool_call_traces(risk_level);