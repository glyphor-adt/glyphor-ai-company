CREATE TABLE IF NOT EXISTS agent_run_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  department TEXT NOT NULL,
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  what TEXT NOT NULL,
  result TEXT,
  next_action TEXT,
  flag TEXT,
  flag_tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_run_status_flag_tier_check
    CHECK (flag_tier IS NULL OR flag_tier IN ('info', 'yellow', 'red'))
);

CREATE INDEX IF NOT EXISTS idx_agent_run_status_dept
  ON agent_run_status(department, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_status_flags
  ON agent_run_status(flag_tier, created_at DESC)
  WHERE flag IS NOT NULL;
