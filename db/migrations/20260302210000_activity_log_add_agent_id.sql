-- Add agent_id and detail columns to activity_log.
-- Multiple engines (simulation, cot, deep_dive, strategy_lab, agent lifecycle)
-- insert with (agent_id, action, detail) but the original schema only has
-- (agent_role, action, summary). This adds the missing columns.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS detail TEXT;

-- Make summary nullable since new inserts use detail instead
ALTER TABLE activity_log ALTER COLUMN summary DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_agent_id ON activity_log(agent_id);
