-- Step 8a: Create fleet_findings table.
-- Promotes P0/P1 findings from audit scripts into live scoring penalties.

CREATE TABLE IF NOT EXISTS fleet_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2')),
  finding_type TEXT NOT NULL,
  description TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ DEFAULT NULL,
  score_penalty NUMERIC DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ff_agent_id ON fleet_findings(agent_id);
CREATE INDEX IF NOT EXISTS idx_ff_unresolved ON fleet_findings(agent_id, severity) WHERE resolved_at IS NULL;
