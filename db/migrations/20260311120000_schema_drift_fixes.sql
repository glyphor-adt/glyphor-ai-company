-- Fix schema drift: add missing columns and expand constraints
-- Issues: workflows missing created_at, activity_log missing activity_type/description,
-- work_assignments missing output, agent_messages constraint too narrow, CMO paused

-- 1. workflows: code queries created_at but table only had started_at
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
UPDATE workflows SET created_at = started_at WHERE created_at IS NULL OR created_at > started_at;

-- 2. activity_log: code inserts activity_type/description but table had action/summary
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS activity_type TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS description TEXT;
-- Make action/summary nullable since some code paths only provide activity_type/description
ALTER TABLE activity_log ALTER COLUMN action DROP NOT NULL;
ALTER TABLE activity_log ALTER COLUMN summary DROP NOT NULL;

-- 3. work_assignments: code queries output but table only had agent_output
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS output TEXT;
UPDATE work_assignments SET output = agent_output WHERE output IS NULL AND agent_output IS NOT NULL;

-- 4. agent_messages: expand message_type CHECK to include types used by code
ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_message_type_check;
ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_message_type_check
  CHECK (message_type IN ('request', 'response', 'info', 'followup', 'task', 'notification', 'status_update', 'alert', 'blocker', 'escalation', 'delegation'));

-- 5. Activate CMO agent
UPDATE company_agents SET status = 'active' WHERE role = 'cmo' AND status != 'active';
