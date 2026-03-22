-- Allow cancelled work_assignments (stale queue cleanup, user-initiated cancellation)

ALTER TABLE work_assignments
  DROP CONSTRAINT IF EXISTS work_assignments_status_check;

ALTER TABLE work_assignments
  ADD CONSTRAINT work_assignments_status_check
  CHECK (status IN (
    'draft', 'pending', 'dispatched', 'in_progress', 'completed',
    'failed', 'blocked', 'needs_revision', 'cancelled'
  ));
