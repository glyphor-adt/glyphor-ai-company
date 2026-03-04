-- Add is_blocked column to agent_tool_grants
-- Emergency override: set is_blocked=true to instantly revoke a tool
-- without waiting for an Entra role update or code deploy.

ALTER TABLE agent_tool_grants
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;

-- Index for fast block lookups (hot path in toolExecutor)
CREATE INDEX IF NOT EXISTS idx_tool_grants_blocked
  ON agent_tool_grants(agent_role) WHERE is_blocked = true;
