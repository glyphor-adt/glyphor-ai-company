-- Optional acceptance timestamp for work assignments (e.g. outcome / task_run_outcomes alignment).
ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NULL;
