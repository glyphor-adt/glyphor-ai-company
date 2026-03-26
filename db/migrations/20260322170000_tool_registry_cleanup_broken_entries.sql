-- Clean up stale / duplicate tool_registry rows; align static implementations with notes.

DELETE FROM tool_registry
WHERE name IN (
  'update_vercel_env_vars',
  'create_git_branch',
  'browse_webpage',
  'list_repo_files'
);

UPDATE tool_registry
SET
  implementation_type = 'static',
  notes = 'Implemented in static tool array — registry entry is metadata only',
  updated_at = NOW()
WHERE name IN ('inspect_cloud_run_service', 'create_decision');

UPDATE tool_registry
SET
  api_config = NULL,
  implementation_type = 'static',
  notes = 'Implemented in packages/agents/src/cto/tools.ts — uses Secret Manager REST API',
  updated_at = NOW()
WHERE name = 'gcp_create_secret';

UPDATE tool_registry
SET
  api_config = NULL,
  implementation_type = 'static',
  notes = 'Implemented in packages/agents/src/competitive-intel/tools.ts — company knowledge competitive_landscape + searchWeb',
  updated_at = NOW()
WHERE name = 'get_competitor_intelligence';

INSERT INTO fleet_findings (agent_id, severity, finding_type, description)
VALUES
  ('tool-registry', 'P2', 'tool_deleted', 'update_vercel_env_vars removed from tool_registry — Vercel/Web Build env flow deprecated; use approved static paths.'),
  ('tool-registry', 'P2', 'tool_deleted', 'create_git_branch removed from tool_registry — duplicate of static create_git_branch in frontendCodeTools / create_branch');
