-- Bulk-resolve P0 fleet findings that are duplicates of already-fixed issues.
-- 1. "agents table missing" — company_agents rename was completed 2026-03-19.
-- 2. "uuid = text" / "uuid/text mismatch" — fixed in read_agent_config (a.id::text = $1).
-- 3. Phantom env vars (SEND_TEAMS_DM_API_KEY, CREATE_DECISION_API_KEY) — these
--    don't exist in code; DM delivery uses A365TeamsChatClient, decisions use Graph API.
-- Real distinct P0s NOT resolved here (require infra/config):
--   - CFO missing GCP_BILLING_API_KEY + GOOGLE_APPLICATION_CREDENTIALS
--   - Mia Chen 0% success rate (needs investigation after other fixes land)

UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: agents→company_agents rename completed]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND (
    description ILIKE '%relation "agents" does not exist%'
    OR description ILIKE '%agents%table%missing%'
    OR description ILIKE '%agents%table%renamed%'
  );

UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: read_agent_config cast fix deployed]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND (
    description ILIKE '%uuid = text%'
    OR description ILIKE '%uuid/text mismatch%'
    OR description ILIKE '%operator does not exist: uuid%'
    OR description ILIKE '%invalid input syntax for type uuid%'
  );

UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: phantom env var — code uses A365TeamsChatClient]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND description ILIKE '%SEND_TEAMS_DM_API_KEY%';

UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: phantom env var — decisions use Graph API postCardToChannel]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND description ILIKE '%CREATE_DECISION_API_KEY%';
