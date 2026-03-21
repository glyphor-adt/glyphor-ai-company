CREATE TABLE IF NOT EXISTS tool_test_classifications (
  tool_name TEXT PRIMARY KEY,
  risk_tier TEXT NOT NULL,
  test_strategy TEXT NOT NULL,
  test_input JSONB,
  skip_reason TEXT,
  source TEXT NOT NULL DEFAULT 'static',
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  classified_by TEXT NOT NULL DEFAULT 'auto',
  manually_reviewed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tool_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_tools INTEGER,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  triggered_by TEXT NOT NULL DEFAULT 'scheduled',  -- 'scheduled' | 'manual' | 'deploy'
  environment TEXT NOT NULL DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS tool_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  test_strategy TEXT NOT NULL,
  test_run_id UUID NOT NULL REFERENCES tool_test_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('pass', 'fail', 'skip', 'error', 'timeout')),
  response_ms INTEGER,                  -- how long the call took
  error_message TEXT,                   -- if failed, exact error
  error_type TEXT,                      -- 'auth' | 'not_found' | 'timeout' | 'schema' | 'connection' | 'unknown'
  schema_valid BOOLEAN,                 -- did definition pass schema validation?
  connectivity_ok BOOLEAN,              -- did service respond?
  execution_ok BOOLEAN,                 -- did tool call succeed?
  raw_response JSONB,                   -- actual response (truncated if large)
  tested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  environment TEXT NOT NULL DEFAULT 'production'
);

CREATE INDEX idx_ttr_tool_name ON tool_test_results(tool_name);
CREATE INDEX idx_ttr_status ON tool_test_results(status);
CREATE INDEX idx_ttr_test_run ON tool_test_results(test_run_id);
CREATE INDEX idx_ttr_tested_at ON tool_test_results(tested_at DESC);
