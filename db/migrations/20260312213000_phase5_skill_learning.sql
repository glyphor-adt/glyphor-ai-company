-- Phase 5: skill extraction + cross-agent transfer support.

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS proposed_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_data JSONB NOT NULL,
  source_agent TEXT NOT NULL REFERENCES company_agents(role),
  source_run_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposed_skills_status
  ON proposed_skills(status, created_at DESC);
