-- Resolve fleet findings for tools already fixed / stale (run manually against prod when ready).
-- Usage: psql "$DATABASE_URL" -f scripts/sql/resolve-fleet-findings-tool-fixes.sql

BEGIN;

UPDATE fleet_findings SET resolved_at = NOW()
WHERE finding_type IN (
  'tool_health_failure:get_gcp_costs',
  'tool_health_failure:query_gcp_billing',
  'tool_health_failure:read_fleet_findings',
  'tool_health_failure:web_search'
)
AND resolved_at IS NULL;

UPDATE fleet_findings SET resolved_at = NOW()
WHERE description ILIKE '%relation "agents" does not exist%'
AND resolved_at IS NULL;

COMMIT;
