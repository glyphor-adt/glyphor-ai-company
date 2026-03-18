-- Step 4: Create assignment_evaluations table.
-- Append-only evaluation history. Replaces mutation of work_assignments.quality_score
-- by storing one row per evaluation event from each evaluator type.

CREATE TABLE IF NOT EXISTS assignment_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  evaluator_type TEXT NOT NULL CHECK (evaluator_type IN ('cos', 'executive', 'team', 'judge', 'constitutional')),
  evaluator_agent_id TEXT,
  score_raw NUMERIC NOT NULL,
  score_normalized NUMERIC NOT NULL CHECK (score_normalized >= 0 AND score_normalized <= 1),
  feedback TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ae_assignment_id ON assignment_evaluations(assignment_id);
CREATE INDEX IF NOT EXISTS idx_ae_evaluator_type ON assignment_evaluations(evaluator_type);
CREATE INDEX IF NOT EXISTS idx_ae_evaluated_at ON assignment_evaluations(evaluated_at DESC);
