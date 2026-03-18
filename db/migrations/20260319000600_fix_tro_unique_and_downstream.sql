-- Fix task_run_outcomes: add unique constraint on run_id (required for ON CONFLICT)
-- and add downstream_status column used by markOutcomeRevised/markOutcomeAccepted.

-- 1. Add unique constraint on run_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_run_outcomes_run_id_key'
  ) THEN
    -- De-duplicate any existing rows before adding constraint (defensive)
    DELETE FROM task_run_outcomes a
    USING task_run_outcomes b
    WHERE a.run_id = b.run_id
      AND a.id > b.id;

    ALTER TABLE task_run_outcomes
      ADD CONSTRAINT task_run_outcomes_run_id_key UNIQUE (run_id);
  END IF;
END $$;

-- 2. Add downstream_status column (used by markOutcomeRevised/markOutcomeAccepted)
ALTER TABLE task_run_outcomes
  ADD COLUMN IF NOT EXISTS downstream_status TEXT;

COMMENT ON COLUMN task_run_outcomes.downstream_status IS
  'Set by orchestrators: revised, accepted — tracks post-completion workflow signals.';
