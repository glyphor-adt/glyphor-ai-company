-- Add missing payload column to agent_schedules
-- The dynamic scheduler code expects this column for passing task parameters
ALTER TABLE agent_schedules ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
