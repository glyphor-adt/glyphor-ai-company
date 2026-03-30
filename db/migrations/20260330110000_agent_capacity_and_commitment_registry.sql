DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_capacity_tier') THEN
    CREATE TYPE agent_capacity_tier AS ENUM ('observe', 'draft', 'execute', 'commit');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commitment_registry_status') THEN
    CREATE TYPE commitment_registry_status AS ENUM (
      'pending_approval',
      'approved',
      'rejected',
      'executed',
      'reversed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_capacity_role_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_category TEXT NOT NULL UNIQUE,
  match_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  capacity_tier agent_capacity_tier NOT NULL,
  requires_human_approval_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_by_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  commit_value_threshold NUMERIC(12,2),
  commit_requires_dual_approval BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_agent_capacity_role_defaults_priority
  ON agent_capacity_role_defaults(priority ASC, role_category ASC);

CREATE TABLE IF NOT EXISTS agent_capacity_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  capacity_tier agent_capacity_tier NOT NULL,
  requires_human_approval_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_by_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_capacity_config_agent_id
  ON agent_capacity_config(agent_id);

CREATE TABLE IF NOT EXISTS commitment_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_description TEXT NOT NULL,
  external_counterparty TEXT,
  commitment_value TEXT,
  tool_called TEXT NOT NULL,
  tool_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_human_id TEXT,
  approved_at TIMESTAMPTZ,
  auto_approved BOOLEAN NOT NULL DEFAULT false,
  status commitment_registry_status NOT NULL DEFAULT 'pending_approval',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_commitment_registry_agent_status_created
  ON commitment_registry(agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commitment_registry_pending
  ON commitment_registry(status, created_at DESC)
  WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_commitment_registry_counterparty
  ON commitment_registry(external_counterparty, created_at DESC);

INSERT INTO agent_capacity_role_defaults (
  role_category,
  match_rules,
  capacity_tier,
  requires_human_approval_for,
  override_by_roles,
  commit_value_threshold,
  commit_requires_dual_approval,
  priority,
  updated_by
)
VALUES
  (
    'research_analyst',
    jsonb_build_object(
      'role_patterns', jsonb_build_array('%research%', '%analyst%', '%intel%'),
      'departments', jsonb_build_array('research', 'product')
    ),
    'observe',
    '[]'::jsonb,
    '["founder","chief_of_staff","global_admin"]'::jsonb,
    NULL,
    false,
    10,
    'migration'
  ),
  (
    'content_draft',
    jsonb_build_object(
      'role_patterns', jsonb_build_array('%content%', '%seo%', '%design%', '%template%'),
      'departments', jsonb_build_array('marketing', 'design')
    ),
    'draft',
    '["publish_content","post_to_briefings","post_to_deliverables"]'::jsonb,
    '["founder","chief_of_staff","cmo"]'::jsonb,
    NULL,
    false,
    20,
    'migration'
  ),
  (
    'operations_execution',
    jsonb_build_object(
      'role_patterns', jsonb_build_array('%ops%', '%admin%', '%engineer%', '%hr%', '%chief-of-staff%'),
      'departments', jsonb_build_array('operations', 'engineering')
    ),
    'execute',
    '["production_deploy","send_email","send_dm","create_calendar_event"]'::jsonb,
    '["founder","chief_of_staff","cto","global_admin"]'::jsonb,
    '5000.00',
    false,
    30,
    'migration'
  ),
  (
    'finance_legal_external',
    jsonb_build_object(
      'role_patterns', jsonb_build_array('%finance%', '%legal%', '%sales%', '%cfo%', '%clo%'),
      'departments', jsonb_build_array('finance', 'legal', 'sales'),
      'title_keywords', jsonb_build_array('finance', 'legal', 'sales', 'counsel', 'vendor', 'external')
    ),
    'execute',
    '["commitment","payment","vendor_agreement","external_commitment"]'::jsonb,
    '["founder","cfo","clo"]'::jsonb,
    '1000.00',
    true,
    40,
    'migration'
  )
ON CONFLICT (role_category) DO UPDATE SET
  match_rules = EXCLUDED.match_rules,
  capacity_tier = EXCLUDED.capacity_tier,
  requires_human_approval_for = EXCLUDED.requires_human_approval_for,
  override_by_roles = EXCLUDED.override_by_roles,
  commit_value_threshold = EXCLUDED.commit_value_threshold,
  commit_requires_dual_approval = EXCLUDED.commit_requires_dual_approval,
  priority = EXCLUDED.priority,
  updated_at = NOW(),
  updated_by = EXCLUDED.updated_by;

CREATE OR REPLACE FUNCTION match_agent_capacity_role_default(
  p_role TEXT,
  p_department TEXT,
  p_title TEXT
) RETURNS agent_capacity_role_defaults
LANGUAGE plpgsql
AS $$
DECLARE
  candidate agent_capacity_role_defaults%ROWTYPE;
BEGIN
  SELECT *
  INTO candidate
  FROM agent_capacity_role_defaults d
  WHERE (
      NOT (d.match_rules ? 'role_patterns')
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(d.match_rules->'role_patterns') AS pattern(value)
        WHERE COALESCE(p_role, '') ILIKE pattern.value
      )
    )
    AND (
      NOT (d.match_rules ? 'departments')
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(d.match_rules->'departments') AS dept(value)
        WHERE LOWER(COALESCE(p_department, '')) = LOWER(dept.value)
      )
    )
    AND (
      NOT (d.match_rules ? 'title_keywords')
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(d.match_rules->'title_keywords') AS keyword(value)
        WHERE LOWER(COALESCE(p_title, '')) LIKE '%' || LOWER(keyword.value) || '%'
      )
    )
  ORDER BY d.priority ASC, d.role_category ASC
  LIMIT 1;

  IF candidate.id IS NOT NULL THEN
    RETURN candidate;
  END IF;

  SELECT *
  INTO candidate
  FROM agent_capacity_role_defaults d
  WHERE d.role_category = 'operations_execution'
  LIMIT 1;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_agent_capacity_config_for_company_agent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  defaults_row agent_capacity_role_defaults%ROWTYPE;
BEGIN
  defaults_row := match_agent_capacity_role_default(NEW.role, NEW.department, NEW.title);

  INSERT INTO agent_capacity_config (
    agent_id,
    capacity_tier,
    requires_human_approval_for,
    override_by_roles,
    updated_at,
    updated_by,
    metadata
  )
  VALUES (
    NEW.role,
    COALESCE(defaults_row.capacity_tier, 'execute'::agent_capacity_tier),
    COALESCE(defaults_row.requires_human_approval_for, '[]'::jsonb),
    COALESCE(defaults_row.override_by_roles, '[]'::jsonb),
    NOW(),
    COALESCE(NEW.created_by, 'system'),
    jsonb_strip_nulls(jsonb_build_object(
      'role_category', defaults_row.role_category,
      'commit_value_threshold', defaults_row.commit_value_threshold,
      'commit_requires_dual_approval', defaults_row.commit_requires_dual_approval
    ))
  )
  ON CONFLICT (agent_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_agents_capacity_defaults ON company_agents;

CREATE TRIGGER trg_company_agents_capacity_defaults
AFTER INSERT ON company_agents
FOR EACH ROW
EXECUTE FUNCTION ensure_agent_capacity_config_for_company_agent();

INSERT INTO agent_capacity_config (
  agent_id,
  capacity_tier,
  requires_human_approval_for,
  override_by_roles,
  updated_at,
  updated_by,
  metadata
)
SELECT
  a.role,
  COALESCE(d.capacity_tier, 'execute'::agent_capacity_tier),
  COALESCE(d.requires_human_approval_for, '[]'::jsonb),
  COALESCE(d.override_by_roles, '[]'::jsonb),
  NOW(),
  'migration',
  jsonb_strip_nulls(jsonb_build_object(
    'role_category', d.role_category,
    'commit_value_threshold', d.commit_value_threshold,
    'commit_requires_dual_approval', d.commit_requires_dual_approval
  ))
FROM company_agents a
LEFT JOIN LATERAL match_agent_capacity_role_default(a.role, a.department, a.title) d ON TRUE
LEFT JOIN agent_capacity_config c ON c.agent_id = a.role
WHERE c.id IS NULL;