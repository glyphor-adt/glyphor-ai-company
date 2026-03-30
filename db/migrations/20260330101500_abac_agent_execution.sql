BEGIN;

DO $$ BEGIN
  CREATE TYPE data_classification_level AS ENUM ('public', 'internal', 'confidential', 'restricted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE abac_permission AS ENUM ('allow', 'deny');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_domain TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  classification_level data_classification_level NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mcp_domain, resource_type)
);

CREATE TABLE IF NOT EXISTS abac_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role_id UUID NOT NULL REFERENCES agent_roles(id) ON DELETE CASCADE,
  mcp_domain TEXT NOT NULL,
  resource_type TEXT,
  classification_level data_classification_level NOT NULL,
  permission abac_permission NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abac_policies_lookup
  ON abac_policies (agent_role_id, mcp_domain, classification_level, priority DESC);

CREATE TABLE IF NOT EXISTS abac_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  mcp_domain TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  classification_level data_classification_level NOT NULL,
  policy_id UUID REFERENCES abac_policies(id) ON DELETE SET NULL,
  decision abac_permission NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abac_audit_log_timestamp
  ON abac_audit_log (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_abac_audit_log_filters
  ON abac_audit_log (agent_role, mcp_domain, resource_type, decision, timestamp DESC);

INSERT INTO agent_roles (name, description)
SELECT DISTINCT role, CONCAT('Imported from company_agents role ', role)
FROM company_agents
WHERE role IS NOT NULL
ON CONFLICT (name) DO NOTHING;

INSERT INTO data_classifications (mcp_domain, resource_type, classification_level)
VALUES
  ('finance', 'payroll_data', 'restricted'),
  ('finance', 'budget_reports', 'confidential'),
  ('finance', 'invoice_data', 'internal'),
  ('hr', 'employee_records', 'restricted'),
  ('hr', 'org_chart', 'internal'),
  ('legal', 'contracts', 'confidential'),
  ('legal', 'ndas', 'restricted'),
  ('engineering', 'code_repos', 'internal'),
  ('engineering', 'deployment_configs', 'confidential'),
  ('design', 'brand_assets', 'internal')
ON CONFLICT (mcp_domain, resource_type) DO UPDATE
SET classification_level = EXCLUDED.classification_level;

INSERT INTO abac_policies (agent_role_id, mcp_domain, resource_type, classification_level, permission, priority)
SELECT ar.id, seed.mcp_domain, seed.resource_type, seed.classification_level::data_classification_level, seed.permission::abac_permission, seed.priority
FROM agent_roles ar
JOIN (
  VALUES
    ('cfo', 'finance', NULL, 'internal', 'allow', 100),
    ('cfo', 'finance', NULL, 'confidential', 'allow', 100),
    ('cfo', 'finance', 'payroll_data', 'restricted', 'allow', 120),
    ('clo', 'legal', NULL, 'confidential', 'allow', 100),
    ('clo', 'legal', 'ndas', 'restricted', 'allow', 120),
    ('head-of-hr', 'hr', NULL, 'internal', 'allow', 100),
    ('head-of-hr', 'hr', 'employee_records', 'restricted', 'allow', 120),
    ('cto', 'engineering', NULL, 'internal', 'allow', 100),
    ('cto', 'engineering', 'deployment_configs', 'confidential', 'allow', 120),
    ('platform-engineer', 'engineering', NULL, 'internal', 'allow', 100),
    ('platform-engineer', 'engineering', 'deployment_configs', 'confidential', 'allow', 120),
    ('devops-engineer', 'engineering', NULL, 'internal', 'allow', 100),
    ('devops-engineer', 'engineering', 'deployment_configs', 'confidential', 'allow', 120),
    ('quality-engineer', 'engineering', 'code_repos', 'internal', 'allow', 100),
    ('frontend-engineer', 'engineering', 'code_repos', 'internal', 'allow', 100),
    ('vp-design', 'design', NULL, 'internal', 'allow', 100),
    ('ui-ux-designer', 'design', NULL, 'internal', 'allow', 100),
    ('design-critic', 'design', NULL, 'internal', 'allow', 100),
    ('template-architect', 'design', NULL, 'internal', 'allow', 100)
) AS seed(role_name, mcp_domain, resource_type, classification_level, permission, priority)
  ON ar.name = seed.role_name
ON CONFLICT DO NOTHING;

COMMIT;