-- Add responding_agent column to chat_messages
-- When an @mentioned agent responds in another agent's chat thread,
-- this column tracks which agent actually authored the response.
-- NULL means the primary agent (agent_role) responded.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS responding_agent TEXT;
