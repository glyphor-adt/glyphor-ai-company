-- Proposed Initiatives — Agent-generated project proposals
-- Executives propose initiatives during proactive work cycles;
-- Sarah evaluates and either creates directives or provides feedback.

CREATE TABLE IF NOT EXISTS proposed_initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by TEXT NOT NULL,
  title TEXT NOT NULL,
  justification TEXT NOT NULL,
  proposed_assignments JSONB NOT NULL DEFAULT '[]',
  expected_outcome TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  estimated_days INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','deferred','rejected')),
  evaluation_notes TEXT,
  evaluated_by TEXT,
  directive_id UUID REFERENCES founder_directives(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL DEFAULT 'glyphor'
);

CREATE INDEX IF NOT EXISTS idx_proposed_initiatives_status ON proposed_initiatives(status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposed_initiatives_proposed_by ON proposed_initiatives(proposed_by, tenant_id);
