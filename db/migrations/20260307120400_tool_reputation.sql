-- Tool reputation tracking — records success/failure rates and quality signals
-- for all tool types (static, runtime, dynamic registry, MCP).
-- The update_tool_stats() function provides atomic upsert for per-call tracking.

CREATE TABLE IF NOT EXISTS tool_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL,  -- 'static' | 'runtime' | 'dynamic_registry' | 'mcp'

  -- Usage stats
  total_calls INTEGER NOT NULL DEFAULT 0,
  successful_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  timeout_calls INTEGER NOT NULL DEFAULT 0,

  -- Quality signals
  avg_latency_ms NUMERIC(10,2),
  downstream_defect_count INTEGER NOT NULL DEFAULT 0,
  contradiction_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,

  -- Computed scores (updated by reputation tracker)
  success_rate NUMERIC(4,3),
  reliability_score NUMERIC(4,3),

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  expired_at TIMESTAMPTZ,
  expiration_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tool_name)
);

CREATE INDEX idx_tool_reputation_source ON tool_reputation(tool_source);
CREATE INDEX idx_tool_reputation_active ON tool_reputation(is_active);
CREATE INDEX idx_tool_reputation_reliability ON tool_reputation(reliability_score);

-- Function for atomic stat updates
CREATE OR REPLACE FUNCTION update_tool_stats(
  p_tool_name TEXT,
  p_tool_source TEXT,
  p_success BOOLEAN,
  p_timed_out BOOLEAN,
  p_latency_ms NUMERIC
) RETURNS void AS $$
BEGIN
  INSERT INTO tool_reputation (tool_name, tool_source, total_calls, successful_calls,
    failed_calls, timeout_calls, avg_latency_ms, last_used_at, success_rate)
  VALUES (p_tool_name, p_tool_source, 1,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN NOT p_success AND NOT p_timed_out THEN 1 ELSE 0 END,
    CASE WHEN p_timed_out THEN 1 ELSE 0 END,
    p_latency_ms, NOW(),
    CASE WHEN p_success THEN 1.0 ELSE 0.0 END)
  ON CONFLICT (tool_name) DO UPDATE SET
    total_calls = tool_reputation.total_calls + 1,
    successful_calls = tool_reputation.successful_calls + CASE WHEN p_success THEN 1 ELSE 0 END,
    failed_calls = tool_reputation.failed_calls + CASE WHEN NOT p_success AND NOT p_timed_out THEN 1 ELSE 0 END,
    timeout_calls = tool_reputation.timeout_calls + CASE WHEN p_timed_out THEN 1 ELSE 0 END,
    avg_latency_ms = (tool_reputation.avg_latency_ms * tool_reputation.total_calls + p_latency_ms) / (tool_reputation.total_calls + 1),
    last_used_at = NOW(),
    last_failed_at = CASE WHEN NOT p_success THEN NOW() ELSE tool_reputation.last_failed_at END,
    success_rate = (tool_reputation.successful_calls + CASE WHEN p_success THEN 1 ELSE 0 END)::NUMERIC
      / (tool_reputation.total_calls + 1),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
