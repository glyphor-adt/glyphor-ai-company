-- Make agent_role nullable and set a default so that inserts using
-- (agent_id, action, detail) don't violate the NOT NULL constraint.
-- Backfill existing NULL rows from agent_id where possible.

ALTER TABLE activity_log ALTER COLUMN agent_role SET DEFAULT 'system';
ALTER TABLE activity_log ALTER COLUMN agent_role DROP NOT NULL;

-- Backfill any rows that were inserted without agent_role
UPDATE activity_log SET agent_role = COALESCE(agent_id, 'system') WHERE agent_role IS NULL;
