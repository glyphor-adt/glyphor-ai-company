-- ═══════════════════════════════════════════════════════════════
-- Enhancement 7: Episodic Replay — Proposed Constitutional Amendments
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposed_constitutional_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  action TEXT NOT NULL, -- 'add' | 'modify' | 'deprecate'
  principle_text TEXT NOT NULL,
  rationale TEXT,
  source TEXT NOT NULL DEFAULT 'episodic_replay',
  status TEXT NOT NULL DEFAULT 'proposed', -- 'proposed' | 'approved' | 'rejected'
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE proposed_constitutional_amendments ENABLE ROW LEVEL SECURITY;
