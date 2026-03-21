-- Bulk-resolve P0 fleet findings that are duplicates of already-fixed issues.
-- 1. "agents table missing" / read_fleet_health wrong table — company_agents rename completed 2026-03-19.
-- 2. "uuid = text" / "uuid/text mismatch" — fixed in read_agent_config (a.id::text = $1).
-- 3. Phantom env vars (SEND_TEAMS_DM_API_KEY, CREATE_DECISION_API_KEY) — these
--    don't exist in code; DM delivery uses A365TeamsChatClient, decisions use Graph API.
-- Real distinct P0s NOT resolved here (require infra/config):
--   - CFO missing GCP_BILLING_API_KEY + GOOGLE_APPLICATION_CREDENTIALS
--   - CFO get_ai_model_costs model/unit_type column mismatch
--   - Mia Chen 0% success rate (needs investigation after other fixes land)
--   - CTO completion rate 52%

-- 1. read_fleet_health referencing old "agents" table (already uses company_agents)
UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: read_fleet_health already uses company_agents]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND (
    description ILIKE '%read_fleet_health%agents%'
    OR description ILIKE '%read_gtm_report%agents%'
    OR description ILIKE '%relation%agents%does not exist%'
    OR description ILIKE '%table%agents%missing%'
    OR description ILIKE '%table named%agents%'
    OR (finding_type IN ('DB_ISSUE', 'infrastructure_failure', 'Infrastructure Failure', 'infrastructure_degradation')
        AND description ILIKE '%agents%')
  );

-- 2. read_agent_config uuid/text mismatch
UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: read_agent_config cast fix deployed]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND (
    description ILIKE '%read_agent_config%uuid%'
    OR description ILIKE '%uuid%text%mismatch%'
    OR description ILIKE '%operator does not exist%uuid%text%'
    OR description ILIKE '%invalid input syntax for type uuid%'
  );

-- 3. Phantom env vars
UPDATE fleet_findings
SET resolved_at = NOW(),
    description = description || ' [auto-resolved: phantom env var]'
WHERE severity = 'P0'
  AND resolved_at IS NULL
  AND (
    description ILIKE '%SEND_TEAMS_DM_API_KEY%'
    OR description ILIKE '%CREATE_DECISION_API_KEY%'
  );
