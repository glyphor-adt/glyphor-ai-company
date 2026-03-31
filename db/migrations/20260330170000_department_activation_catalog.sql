BEGIN;

DO $$ BEGIN
  CREATE TYPE department_activation_status AS ENUM ('available', 'configuring', 'active', 'paused');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_key TEXT,
  default_agent_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_mcp_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_mcp_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  activation_order_hint INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_activation_order_hint
  ON departments (activation_order_hint ASC, name ASC);

CREATE TABLE IF NOT EXISTS department_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  status department_activation_status NOT NULL DEFAULT 'configuring',
  activated_at TIMESTAMPTZ,
  activated_by_human_id TEXT,
  agent_count INT NOT NULL DEFAULT 0,
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_department_activations_tenant_status
  ON department_activations (tenant_id, status, department_id);

CREATE TABLE IF NOT EXISTS agent_catalog_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  default_role TEXT NOT NULL,
  default_capacity_tier agent_capacity_tier NOT NULL DEFAULT 'observe',
  default_disclosure_level disclosure_level NOT NULL DEFAULT 'internal_only',
  default_autonomy_max_level INT NOT NULL DEFAULT 0 CHECK (default_autonomy_max_level BETWEEN 0 AND 4),
  default_mcp_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_abac_policies JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_prompt_template TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_catalog_templates_department
  ON agent_catalog_templates (department_id, default_role);

INSERT INTO departments (
  name,
  description,
  icon_key,
  default_agent_roles,
  required_mcp_domains,
  recommended_mcp_domains,
  activation_order_hint,
  created_at
)
SELECT
  seeded.department_name,
  seeded.description,
  seeded.icon_key,
  seeded.default_agent_roles,
  seeded.required_mcp_domains,
  seeded.recommended_mcp_domains,
  seeded.activation_order_hint,
  NOW()
FROM (
  SELECT
    ca.department AS department_name,
    CONCAT(
      'Activate Glyphor''s ',
      ca.department,
      ' department with a pre-built catalog of agents and recommended integrations.'
    ) AS description,
    CASE
      WHEN LOWER(ca.department) LIKE '%engineering%' THEN 'engineering'
      WHEN LOWER(ca.department) LIKE '%finance%' THEN 'finance'
      WHEN LOWER(ca.department) LIKE '%marketing%' THEN 'marketing'
      WHEN LOWER(ca.department) LIKE '%product%' THEN 'product'
      WHEN LOWER(ca.department) LIKE '%legal%' THEN 'legal'
      WHEN LOWER(ca.department) LIKE '%research%' THEN 'research'
      WHEN LOWER(ca.department) LIKE '%design%' THEN 'design'
      WHEN LOWER(ca.department) LIKE '%sales%' THEN 'sales'
      WHEN LOWER(ca.department) LIKE '%hr%' THEN 'hr'
      WHEN LOWER(ca.department) LIKE '%operations%' OR LOWER(ca.department) LIKE '%it%' THEN 'operations'
      ELSE lower(regexp_replace(ca.department, '[^a-z0-9]+', '-', 'gi'))
    END AS icon_key,
    to_jsonb(array_agg(ca.role ORDER BY ca.is_core DESC, ca.role ASC)) AS default_agent_roles,
    CASE
      WHEN LOWER(ca.department) LIKE '%engineering%' THEN to_jsonb(ARRAY['engineering','github','deployments'])
      WHEN LOWER(ca.department) LIKE '%finance%' THEN to_jsonb(ARRAY['finance'])
      WHEN LOWER(ca.department) LIKE '%marketing%' THEN to_jsonb(ARRAY['marketing'])
      WHEN LOWER(ca.department) LIKE '%product%' THEN to_jsonb(ARRAY['research'])
      WHEN LOWER(ca.department) LIKE '%legal%' THEN to_jsonb(ARRAY['legal'])
      WHEN LOWER(ca.department) LIKE '%hr%' THEN to_jsonb(ARRAY['hr'])
      WHEN LOWER(ca.department) LIKE '%sales%' THEN to_jsonb(ARRAY['sales'])
      WHEN LOWER(ca.department) LIKE '%design%' THEN to_jsonb(ARRAY['design'])
      WHEN LOWER(ca.department) LIKE '%research%' THEN to_jsonb(ARRAY['research'])
      WHEN LOWER(ca.department) LIKE '%operations%' OR LOWER(ca.department) LIKE '%it%' THEN to_jsonb(ARRAY['operations'])
      ELSE '[]'::jsonb
    END AS required_mcp_domains,
    CASE
      WHEN LOWER(ca.department) LIKE '%engineering%' THEN to_jsonb(ARRAY['operations','security'])
      WHEN LOWER(ca.department) LIKE '%finance%' THEN to_jsonb(ARRAY['legal','operations'])
      WHEN LOWER(ca.department) LIKE '%marketing%' THEN to_jsonb(ARRAY['sales','research','design'])
      WHEN LOWER(ca.department) LIKE '%product%' THEN to_jsonb(ARRAY['research','design','engineering'])
      WHEN LOWER(ca.department) LIKE '%legal%' THEN to_jsonb(ARRAY['finance','operations'])
      WHEN LOWER(ca.department) LIKE '%sales%' THEN to_jsonb(ARRAY['marketing','finance'])
      WHEN LOWER(ca.department) LIKE '%research%' THEN to_jsonb(ARRAY['marketing','product'])
      WHEN LOWER(ca.department) LIKE '%design%' THEN to_jsonb(ARRAY['marketing','product','engineering'])
      WHEN LOWER(ca.department) LIKE '%operations%' OR LOWER(ca.department) LIKE '%it%' THEN to_jsonb(ARRAY['engineering','finance','hr'])
      WHEN LOWER(ca.department) LIKE '%executive%' THEN to_jsonb(ARRAY['operations','finance','research'])
      ELSE '[]'::jsonb
    END AS recommended_mcp_domains,
    CASE
      WHEN LOWER(ca.department) LIKE '%executive%' THEN 10
      WHEN LOWER(ca.department) LIKE '%operations%' OR LOWER(ca.department) LIKE '%it%' THEN 20
      WHEN LOWER(ca.department) LIKE '%marketing%' THEN 30
      WHEN LOWER(ca.department) LIKE '%sales%' THEN 40
      WHEN LOWER(ca.department) LIKE '%product%' THEN 50
      WHEN LOWER(ca.department) LIKE '%engineering%' THEN 60
      WHEN LOWER(ca.department) LIKE '%design%' THEN 70
      WHEN LOWER(ca.department) LIKE '%finance%' THEN 80
      WHEN LOWER(ca.department) LIKE '%legal%' THEN 90
      WHEN LOWER(ca.department) LIKE '%research%' THEN 100
      WHEN LOWER(ca.department) LIKE '%hr%' THEN 110
      ELSE 120
    END AS activation_order_hint
  FROM company_agents ca
  WHERE COALESCE(NULLIF(TRIM(ca.department), ''), '') <> ''
    AND COALESCE(ca.status, 'active') <> 'retired'
  GROUP BY ca.department
) AS seeded
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon_key = EXCLUDED.icon_key,
  default_agent_roles = EXCLUDED.default_agent_roles,
  required_mcp_domains = EXCLUDED.required_mcp_domains,
  recommended_mcp_domains = EXCLUDED.recommended_mcp_domains,
  activation_order_hint = EXCLUDED.activation_order_hint;

INSERT INTO agent_catalog_templates (
  department_id,
  template_name,
  default_role,
  default_capacity_tier,
  default_disclosure_level,
  default_autonomy_max_level,
  default_mcp_domains,
  default_abac_policies,
  system_prompt_template,
  created_at
)
SELECT
  d.id,
  COALESCE(NULLIF(TRIM(ca.title), ''), initcap(replace(ca.role, '-', ' '))),
  ca.role,
  COALESCE(acc.capacity_tier, 'observe'::agent_capacity_tier),
  COALESCE(adc.disclosure_level, 'internal_only'::disclosure_level),
  COALESCE(aac.max_allowed_level, 0),
  COALESCE(
    (
      SELECT to_jsonb(array_agg(DISTINCT p.mcp_domain ORDER BY p.mcp_domain))
      FROM agent_roles ar
      JOIN abac_policies p ON p.agent_role_id = ar.id
      WHERE ar.name = ca.role
    ),
    CASE
      WHEN LOWER(ca.department) LIKE '%engineering%' THEN to_jsonb(ARRAY['engineering'])
      WHEN LOWER(ca.department) LIKE '%finance%' THEN to_jsonb(ARRAY['finance'])
      WHEN LOWER(ca.department) LIKE '%marketing%' THEN to_jsonb(ARRAY['marketing'])
      WHEN LOWER(ca.department) LIKE '%product%' THEN to_jsonb(ARRAY['research'])
      WHEN LOWER(ca.department) LIKE '%legal%' THEN to_jsonb(ARRAY['legal'])
      WHEN LOWER(ca.department) LIKE '%hr%' THEN to_jsonb(ARRAY['hr'])
      WHEN LOWER(ca.department) LIKE '%sales%' THEN to_jsonb(ARRAY['sales'])
      WHEN LOWER(ca.department) LIKE '%design%' THEN to_jsonb(ARRAY['design'])
      WHEN LOWER(ca.department) LIKE '%research%' THEN to_jsonb(ARRAY['research'])
      WHEN LOWER(ca.department) LIKE '%operations%' OR LOWER(ca.department) LIKE '%it%' THEN to_jsonb(ARRAY['operations'])
      ELSE '[]'::jsonb
    END
  ),
  COALESCE(
    (
      SELECT jsonb_agg(policy_row.policy ORDER BY policy_row.priority DESC, policy_row.mcp_domain ASC)
      FROM (
        SELECT DISTINCT
          p.priority,
          p.mcp_domain,
          jsonb_build_object(
            'mcp_domain', p.mcp_domain,
            'resource_type', p.resource_type,
            'classification_level', p.classification_level,
            'permission', p.permission,
            'priority', p.priority
          ) AS policy
        FROM agent_roles ar
        JOIN abac_policies p ON p.agent_role_id = ar.id
        WHERE ar.name = ca.role
      ) AS policy_row
    ),
    '[]'::jsonb
  ),
  CONCAT(
    'You are {{agent_name}}, the Glyphor ',
    COALESCE(NULLIF(TRIM(ca.title), ''), initcap(replace(ca.role, '-', ' '))),
    ' for {{company_name}}''s {{department}} department. ',
    'Operate as a department-specific AI teammate. Focus on {{department}} outcomes, collaborate with other active Glyphor departments when needed, keep decisions explicit, and escalate uncertainty rather than fabricating. ',
    'Use available MCP domains responsibly and keep communications aligned with {{company_name}}''s current operating context.'
  ),
  NOW()
FROM company_agents ca
JOIN departments d ON d.name = ca.department
LEFT JOIN agent_capacity_config acc ON acc.agent_id = ca.role
LEFT JOIN agent_disclosure_config adc ON adc.agent_id = ca.role
LEFT JOIN agent_autonomy_config aac ON aac.agent_id = ca.role
WHERE COALESCE(NULLIF(TRIM(ca.department), ''), '') <> ''
  AND COALESCE(ca.status, 'active') <> 'retired'
ON CONFLICT (department_id, template_name) DO UPDATE SET
  default_role = EXCLUDED.default_role,
  default_capacity_tier = EXCLUDED.default_capacity_tier,
  default_disclosure_level = EXCLUDED.default_disclosure_level,
  default_autonomy_max_level = EXCLUDED.default_autonomy_max_level,
  default_mcp_domains = EXCLUDED.default_mcp_domains,
  default_abac_policies = EXCLUDED.default_abac_policies,
  system_prompt_template = EXCLUDED.system_prompt_template;

COMMIT;