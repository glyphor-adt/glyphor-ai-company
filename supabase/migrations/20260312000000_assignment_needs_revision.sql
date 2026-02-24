-- Add 'needs_revision' status to work_assignments for Sarah's review loop
-- When Sarah evaluates a submission and requests changes, the assignment
-- moves to needs_revision so the agent sees feedback on their next run.

ALTER TABLE work_assignments
  DROP CONSTRAINT IF EXISTS work_assignments_status_check;

ALTER TABLE work_assignments
  ADD CONSTRAINT work_assignments_status_check
  CHECK (status IN ('pending', 'dispatched', 'in_progress', 'completed', 'failed', 'blocked', 'needs_revision'));
