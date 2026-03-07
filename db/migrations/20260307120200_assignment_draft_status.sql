-- Add 'draft' status for assignments pending plan verification.
-- Draft assignments are not picked up by the work loop until verified.
-- After verification:
--   APPROVE / WARN → status promoted to 'pending' (normal flow)
--   REVISE         → stays 'draft' with feedback for re-decomposition

ALTER TABLE work_assignments
  DROP CONSTRAINT IF EXISTS work_assignments_status_check;

ALTER TABLE work_assignments
  ADD CONSTRAINT work_assignments_status_check
  CHECK (status IN ('draft', 'pending', 'dispatched', 'in_progress', 'completed', 'failed', 'blocked', 'needs_revision'));
