-- Per-run quality score: immediate evaluation at task completion
-- Adds a deterministic quality score that is computed and stored at run time
-- using only signals available immediately (final_status, turn_count,
-- tool_failure_count, had_partial_save, cost_usd).
--
-- This complements batch_quality_score (which waits for delayed acceptance /
-- revision signals) by ensuring every completed task has a quality signal the
-- moment it finishes, enabling real-time feedback loops for the Learning Governor.

ALTER TABLE task_run_outcomes
  ADD COLUMN IF NOT EXISTS per_run_quality_score NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS per_run_evaluation_notes TEXT;

COMMENT ON COLUMN task_run_outcomes.per_run_quality_score IS
  'Immediate quality score (1.0–5.0) derived from deterministic signals at run time; populated by harvestTaskOutcome before delayed signals are available.';

COMMENT ON COLUMN task_run_outcomes.per_run_evaluation_notes IS
  'Human-readable breakdown of per_run_quality_score signals.';

CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_per_run_score
  ON task_run_outcomes(per_run_quality_score)
  WHERE per_run_quality_score IS NOT NULL;
