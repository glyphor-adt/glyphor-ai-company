-- Shadow Runs: A/B test new prompt versions against the live baseline.
-- Promotion is score-gated (N≥10, >5% improvement, ≥0.70 floor).

CREATE TABLE IF NOT EXISTS shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'system',
  agent_id TEXT NOT NULL,
  challenger_prompt_version INTEGER NOT NULL,  -- the version being tested
  baseline_prompt_version INTEGER NOT NULL,    -- the current live version
  run_id UUID REFERENCES agent_runs(id),
  baseline_run_id UUID REFERENCES agent_runs(id),
  challenger_score NUMERIC,
  baseline_score NUMERIC,
  task_input TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'evaluated', 'promoted', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_sr_agent_challenger ON shadow_runs(agent_id, challenger_prompt_version);
CREATE INDEX IF NOT EXISTS idx_sr_status ON shadow_runs(status);
CREATE INDEX IF NOT EXISTS idx_sr_tenant_agent ON shadow_runs(tenant_id, agent_id);
