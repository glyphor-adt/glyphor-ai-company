-- ============================================================
-- Add need_type and blocker_reason columns to work_assignments
-- These columns track what is blocking an assignment and what type
-- of input/resource is needed to unblock it.
-- ============================================================

ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS need_type TEXT;
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
