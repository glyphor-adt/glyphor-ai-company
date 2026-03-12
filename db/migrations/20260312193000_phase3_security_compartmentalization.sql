-- Phase 3 security hardening: behavioral anomaly logging + knowledge scopes.

ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS knowledge_access_scope TEXT[] NOT NULL DEFAULT ARRAY['general'];

UPDATE company_agents
SET knowledge_access_scope = ARRAY['operations', 'strategy', 'cross-functional', 'general']
WHERE role IN ('chief-of-staff', 'ops')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['engineering', 'infrastructure', 'security', 'devops', 'general']
WHERE role IN ('cto', 'platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['finance', 'financial', 'revenue', 'costs', 'billing', 'general']
WHERE role IN ('cfo', 'revenue-analyst', 'cost-analyst', 'bob-the-tax-pro')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['product', 'research', 'competitive', 'market', 'general']
WHERE role IN ('cpo', 'user-researcher', 'competitive-intel', 'vp-research', 'competitive-research-analyst', 'market-research-analyst')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['marketing', 'content', 'brand', 'seo', 'social', 'general']
WHERE role IN ('cmo', 'content-creator', 'seo-analyst', 'social-media-manager', 'marketing-intelligence-analyst')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['sales', 'revenue', 'accounts', 'general']
WHERE role IN ('vp-sales', 'account-research')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['design', 'ux', 'product', 'general']
WHERE role IN ('vp-design', 'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['legal', 'compliance', 'contracts', 'privacy', 'general']
WHERE role IN ('clo')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['people', 'hr', 'general']
WHERE role IN ('head-of-hr')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

UPDATE company_agents
SET knowledge_access_scope = ARRAY['operations', 'security', 'compliance', 'general']
WHERE role IN ('global-admin', 'adi-rose')
  AND (knowledge_access_scope IS NULL OR knowledge_access_scope = ARRAY['general']);

CREATE TABLE IF NOT EXISTS security_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_name TEXT,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_security_anomalies_agent
  ON security_anomalies(tenant_id, agent_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_anomalies_severity
  ON security_anomalies(tenant_id, severity, created_at DESC);

ALTER TABLE security_anomalies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'security_anomalies'
      AND policyname = 'tenant_isolation_security_anomalies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_security_anomalies ON security_anomalies
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'security_anomalies'
      AND policyname = 'system_bypass_security_anomalies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_security_anomalies ON security_anomalies
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;
