-- Add approval gate for change requests: pending_approval status + approved_by/approved_at columns

-- Drop the existing status constraint and add pending_approval
ALTER TABLE dashboard_change_requests
  DROP CONSTRAINT IF EXISTS dashboard_change_requests_status_check;

ALTER TABLE dashboard_change_requests
  ADD CONSTRAINT dashboard_change_requests_status_check
  CHECK (status IN ('pending_approval', 'submitted', 'triaged', 'in_progress', 'review', 'deployed', 'rejected'));

-- Add approval tracking columns
ALTER TABLE dashboard_change_requests
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
