-- markOutcomeAccepted() sets accepted_at on task_run_outcomes; column was missing vs work_assignments-only migration.
ALTER TABLE task_run_outcomes
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN task_run_outcomes.accepted_at IS
  'Orchestrator acceptance time (evaluate_assignment accept / evaluate_team_output accept).';
