-- Code paths that INSERT into agent_tool_grants without tenant_id were failing with:
--   null value in column "tenant_id" ... violates not-null constraint
-- after tenant isolation (20260327180000). A server default keeps legacy INSERTs safe.

ALTER TABLE agent_tool_grants
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
