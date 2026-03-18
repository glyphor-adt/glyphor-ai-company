-- Step 3a: Add backfill_source to task_run_outcomes for tracking recovered assignment linkages.
-- Step 1d: Add assignment_id to constitutional_evaluations for eval→assignment linkage.

ALTER TABLE task_run_outcomes
  ADD COLUMN IF NOT EXISTS backfill_source TEXT DEFAULT NULL;

ALTER TABLE constitutional_evaluations
  ADD COLUMN IF NOT EXISTS assignment_id UUID DEFAULT NULL REFERENCES work_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_const_eval_assignment ON constitutional_evaluations(assignment_id)
  WHERE assignment_id IS NOT NULL;
