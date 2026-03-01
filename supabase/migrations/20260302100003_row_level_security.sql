-- Multi-tenancy: Row Level Security for tenant isolation

-- Create system role for scheduler bypass
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glyphor_system') THEN
    CREATE ROLE glyphor_system NOLOGIN;
  END IF;
END
$$;

-- Grant bypass to glyphor_app user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glyphor_app') THEN
    GRANT glyphor_system TO glyphor_app;
  END IF;
END
$$;

-- Enable RLS on new tenant tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents ENABLE ROW LEVEL SECURITY;

-- Enable RLS on existing tables
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_directives ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_trust_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_constitutions ENABLE ROW LEVEL SECURITY;

-- Tenant access policies for new tables

CREATE POLICY tenant_isolation_tenants ON tenants
  USING (id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_tenant_workspaces ON tenant_workspaces
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_tenant_agents ON tenant_agents
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Tenant access policies for existing tables

CREATE POLICY tenant_isolation_agent_runs ON agent_runs
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_kg_nodes ON kg_nodes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_kg_edges ON kg_edges
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_shared_episodes ON shared_episodes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_activity_log ON activity_log
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_founder_directives ON founder_directives
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_work_assignments ON work_assignments
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_messages ON agent_messages
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_meetings ON agent_meetings
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_briefs ON agent_briefs
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_trust_scores ON agent_trust_scores
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_drift_alerts ON drift_alerts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_platform_audit_log ON platform_audit_log
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_constitutions ON agent_constitutions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- System bypass policies (glyphor_system role bypasses RLS)

CREATE POLICY system_bypass_tenants ON tenants
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_tenant_workspaces ON tenant_workspaces
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_tenant_agents ON tenant_agents
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_runs ON agent_runs
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_kg_nodes ON kg_nodes
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_kg_edges ON kg_edges
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_shared_episodes ON shared_episodes
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_activity_log ON activity_log
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_founder_directives ON founder_directives
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_work_assignments ON work_assignments
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_messages ON agent_messages
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_meetings ON agent_meetings
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_briefs ON agent_briefs
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_trust_scores ON agent_trust_scores
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_drift_alerts ON drift_alerts
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_platform_audit_log ON platform_audit_log
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_constitutions ON agent_constitutions
  TO glyphor_system USING (true) WITH CHECK (true);
