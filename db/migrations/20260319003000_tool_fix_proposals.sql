-- ============================================================================
-- Tool Fix Proposals — Structured code fix tickets created by Nexus
-- When Nexus diagnoses a tool bug (schema mismatch, missing implementation,
-- auth failure), it creates a fix proposal with root cause and exact fix.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tool_fix_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name       TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2')),
  root_cause      TEXT NOT NULL,
  affected_agents TEXT[] NOT NULL DEFAULT '{}',
  current_behavior TEXT,
  expected_behavior TEXT,
  fix_description TEXT NOT NULL,
  blocking_gtm    BOOLEAN NOT NULL DEFAULT false,
  proposed_by     TEXT NOT NULL DEFAULT 'platform-intel',
  reviewed_by     TEXT,
  review_notes    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'applied', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tool_fix_proposals_status ON tool_fix_proposals(status);
CREATE INDEX IF NOT EXISTS idx_tool_fix_proposals_severity ON tool_fix_proposals(severity);
CREATE INDEX IF NOT EXISTS idx_tool_fix_proposals_tool ON tool_fix_proposals(tool_name);
