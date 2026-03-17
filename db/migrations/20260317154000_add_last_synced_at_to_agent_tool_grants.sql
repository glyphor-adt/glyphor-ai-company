-- Add freshness tracking for static grant mirror sync.

BEGIN;

ALTER TABLE agent_tool_grants
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

COMMIT;
