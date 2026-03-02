-- ============================================================
-- Fix work_assignments schema for assign_task tool
--
-- 1. Add assigned_by column to track who created the assignment
-- 2. Make directive_id nullable since not all assignments come from directives
--    (e.g., CTO can assign tasks directly without a directive)
-- ============================================================

-- Add assigned_by column
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS assigned_by TEXT;

-- Make directive_id nullable - drop NOT NULL constraint
ALTER TABLE work_assignments ALTER COLUMN directive_id DROP NOT NULL;

-- Create index on assigned_by for queries
CREATE INDEX IF NOT EXISTS idx_work_assignments_assigned_by ON work_assignments(assigned_by);
