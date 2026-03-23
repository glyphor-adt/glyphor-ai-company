-- Deactivate experimental / duplicate / test agents in company_agents (soft cleanup).
-- Rows are kept for FK integrity; Operations dashboard hides inactive/retired/deleted.
--
-- Keeps canonical fleet + intentional Pulse/remediation agents:
--   social-media-manager, social-media-coordinator, product-manager-pulse,
--   telemetry-observability-specialist (see 20260319130000_remediate_incomplete_agents.sql)

-- 1) Obvious sandbox / QA prefixes (dynamic create, evals, scratch runs)
UPDATE company_agents
SET status = 'inactive', updated_at = NOW()
WHERE status = 'active'
  AND (
    role ~* '^(test-|temporary-|scratch-|demo-|sandbox-|fake-|mock-)'
  );

-- 2) Temporary agents that never ran (TTL-style garbage)
UPDATE company_agents
SET status = 'inactive', updated_at = NOW()
WHERE status = 'active'
  AND is_temporary = true
  AND COALESCE(total_runs, 0) = 0
  AND last_run_at IS NULL;

-- 3) Past explicit expiry
UPDATE company_agents
SET status = 'inactive', updated_at = NOW()
WHERE status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at < NOW();

-- 4) Redundant marketing/social experiment roles (canonical social is social-media-manager).
--    Does NOT touch social-media-coordinator, product-manager-pulse, or telemetry-observability-specialist.
UPDATE company_agents
SET status = 'inactive', updated_at = NOW()
WHERE status = 'active'
  AND role IN (
    'platform-operations-specialist',
    'social-media-specialist',
    'social-media-strategist',
    'social-media-strategy-specialist',
    'social-media-publisher',
    'mia-chen',
    'elena-rossi'
  );

-- 5) Slug duplicates / mis-keyed display names (fleet audit noise)
UPDATE company_agents
SET status = 'inactive', updated_at = NOW()
WHERE status = 'active'
  AND role IN (
    'observability-specialist',
    'media-strategy-specialist',
    'dia-coverage-specialist',
    'm-operations-specialist'
  );
