-- ============================================================
-- DIRECTIVE PROPOSALS
-- Allow Sarah (Chief of Staff) to propose directives for
-- founder approval before dispatch.
-- ============================================================

-- Update status CHECK to include 'proposed' and 'rejected'
ALTER TABLE founder_directives
  DROP CONSTRAINT IF EXISTS founder_directives_status_check;
ALTER TABLE founder_directives
  ADD CONSTRAINT founder_directives_status_check
  CHECK (status IN ('proposed', 'active', 'paused', 'completed', 'cancelled', 'rejected'));

-- Update category CHECK to include 'strategy' and 'design'
ALTER TABLE founder_directives
  DROP CONSTRAINT IF EXISTS founder_directives_category_check;
ALTER TABLE founder_directives
  ADD CONSTRAINT founder_directives_category_check
  CHECK (category IN (
    'revenue', 'product', 'engineering', 'marketing',
    'sales', 'customer_success', 'operations', 'general',
    'strategy', 'design'
  ));

-- Add proposal metadata columns
ALTER TABLE founder_directives
  ADD COLUMN IF NOT EXISTS proposed_by TEXT DEFAULT 'founder',
  ADD COLUMN IF NOT EXISTS proposal_reason TEXT,
  ADD COLUMN IF NOT EXISTS source_directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Index for dashboard: quickly find proposed directives
CREATE INDEX IF NOT EXISTS idx_directives_proposed
  ON founder_directives(status) WHERE status = 'proposed';

-- Index for follow-up chain
CREATE INDEX IF NOT EXISTS idx_directives_source
  ON founder_directives(source_directive_id) WHERE source_directive_id IS NOT NULL;

-- Backfill existing rows
UPDATE founder_directives SET proposed_by = 'founder' WHERE proposed_by IS NULL;

-- Grant propose_directive to chief-of-staff
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by)
VALUES ('chief-of-staff', 'propose_directive', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
