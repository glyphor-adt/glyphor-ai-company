-- Distributed Orchestration Schema
-- Adds parent_assignment_id, assignment_type to work_assignments
-- Creates handoffs table for cross-functional coordination

-- Parent assignment linking (executive outcome → team tasks)
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS parent_assignment_id UUID REFERENCES work_assignments(id);

-- Assignment type classification
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'standard'
  CHECK (assignment_type IN ('executive_outcome', 'team_task', 'peer_request', 'standard'));

-- Indexes for two-tier queries
CREATE INDEX IF NOT EXISTS idx_work_assignments_parent ON work_assignments(parent_assignment_id);
CREATE INDEX IF NOT EXISTS idx_work_assignments_type ON work_assignments(assignment_type);

-- Backfill: assignments with no assigned_by were dispatched by Sarah
UPDATE work_assignments SET assigned_by = 'chief-of-staff' WHERE assigned_by IS NULL;

-- Cross-functional handoffs table
CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  initiated_by TEXT NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}',
  deliverables JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  directive_id UUID REFERENCES founder_directives(id),
  tenant_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
CREATE INDEX IF NOT EXISTS idx_handoffs_initiated_by ON handoffs(initiated_by);
CREATE INDEX IF NOT EXISTS idx_handoffs_tenant ON handoffs(tenant_id);
