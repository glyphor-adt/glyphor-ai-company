CREATE TABLE IF NOT EXISTS agent_world_model_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('positive', 'negative')),
  skill TEXT NOT NULL,
  description TEXT NOT NULL,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_world_model_evidence_role_created
  ON agent_world_model_evidence (agent_role, created_at DESC);
