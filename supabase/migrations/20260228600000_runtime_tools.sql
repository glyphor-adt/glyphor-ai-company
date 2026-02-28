-- Runtime Tools — Persisted tools created by agents at runtime.
-- Agents (primarily CTO) can define new tools mid-run that become
-- immediately usable and persist for future runs.

CREATE TABLE runtime_tools (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT UNIQUE NOT NULL,
  description      TEXT NOT NULL,
  parameters       JSONB NOT NULL,
  implementation   JSONB NOT NULL,
  created_by       TEXT NOT NULL,              -- agent role that created it
  is_active        BOOLEAN NOT NULL DEFAULT true,
  uses             INTEGER NOT NULL DEFAULT 0,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runtime_tools_active ON runtime_tools(is_active) WHERE is_active = true;

-- Grant CTO the ability to create runtime tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, is_active)
VALUES ('cto', 'create_runtime_tool', 'system', 'CTO can create runtime tools for the organization', true)
ON CONFLICT (agent_role, tool_name) DO NOTHING;
