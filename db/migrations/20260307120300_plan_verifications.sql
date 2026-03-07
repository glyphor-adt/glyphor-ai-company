-- Plan verification audit trail.
-- Records the result of every pre-flight plan check for observability.

CREATE TABLE IF NOT EXISTS plan_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES founder_directives(id),
  verdict TEXT NOT NULL,  -- 'APPROVE' | 'WARN' | 'REVISE'
  overall_score NUMERIC(3,2),
  checks JSONB NOT NULL,
  suggestions TEXT[],
  assignment_count INTEGER NOT NULL,
  llm_verified BOOLEAN NOT NULL DEFAULT false,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plan_verifications_directive ON plan_verifications(directive_id);
