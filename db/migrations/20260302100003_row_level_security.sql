-- Multi-tenancy: Row Level Security for tenant isolation
--
-- SECURITY MODEL:
-- ---------------
-- 1. glyphor_system role: NOLOGIN role with RLS bypass policies
-- 2. glyphor_system_user: Dedicated LOGIN user for backend services (scheduler, worker)
--    - Should be set as DB_USER for services that need systemQuery() access
--    - Has glyphor_system granted, allowing SET ROLE glyphor_system for RLS bypass
-- 3. glyphor_app: General application role (NOT granted glyphor_system)
--    - Used by dashboard and other tenant-scoped services
--    - Cannot bypass RLS, ensuring tenant isolation
--
-- DEPLOYMENT:
-- -----------
-- Backend services (scheduler, worker): DB_USER=glyphor_system_user
-- Dashboard and tenant-scoped services: DB_USER=glyphor_app (or tenant-specific users)
--
-- PASSWORD SETUP:
-- --------------
-- After running this migration, set a password for glyphor_system_user:
--   ALTER ROLE glyphor_system_user WITH PASSWORD 'REPLACE_WITH_SECURE_PASSWORD';
-- Generate a strong password: openssl rand -base64 32
-- Store the password in GCP Secret Manager as 'db-system-password'

-- Create system role for scheduler bypass
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glyphor_system') THEN
    CREATE ROLE glyphor_system NOLOGIN;
  END IF;
END
$$;

-- Note: Do NOT grant glyphor_system to general application roles like glyphor_app
-- to preserve multi-tenant isolation. Instead, the application should connect
-- using a dedicated user (e.g., postgres or a service account) that has
-- glyphor_system granted. This ensures only explicit SET ROLE glyphor_system
-- calls (via systemQuery) can bypass RLS, not all connections.

-- Create dedicated system user for scheduler/worker services that need RLS bypass
-- This user should be used ONLY by backend services (scheduler, worker) via DB_USER env var
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glyphor_system_user') THEN
    CREATE ROLE glyphor_system_user LOGIN;
    GRANT glyphor_system TO glyphor_system_user;
  END IF;
END
$$;

-- Grant glyphor_system to postgres superuser for admin operations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT glyphor_system TO postgres;
  END IF;
END
$$;

-- Grant table/sequence access to glyphor_system so SET ROLE works for queries
GRANT ALL ON ALL TABLES IN SCHEMA public TO glyphor_system;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO glyphor_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO glyphor_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO glyphor_system;

-- Enable RLS on new tenant tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents ENABLE ROW LEVEL SECURITY;

-- Enable RLS on existing tables (skip if table doesn't exist)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_runs') THEN
    ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_nodes') THEN
    ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_edges') THEN
    ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shared_episodes') THEN
    ALTER TABLE shared_episodes ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_log') THEN
    ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_directives') THEN
    ALTER TABLE founder_directives ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_assignments') THEN
    ALTER TABLE work_assignments ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_messages') THEN
    ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_meetings') THEN
    ALTER TABLE agent_meetings ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_briefs') THEN
    ALTER TABLE agent_briefs ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_trust_scores') THEN
    ALTER TABLE agent_trust_scores ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drift_alerts') THEN
    ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_audit_log') THEN
    ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_constitutions') THEN
    ALTER TABLE agent_constitutions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Tenant access policies for new tables

CREATE POLICY tenant_isolation_tenants ON tenants
  USING (id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_tenant_workspaces ON tenant_workspaces
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_tenant_agents ON tenant_agents
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Tenant access policies for existing tables (skip if table doesn't exist)

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_runs') THEN
    CREATE POLICY tenant_isolation_agent_runs ON agent_runs
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_nodes') THEN
    CREATE POLICY tenant_isolation_kg_nodes ON kg_nodes
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_edges') THEN
    CREATE POLICY tenant_isolation_kg_edges ON kg_edges
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shared_episodes') THEN
    CREATE POLICY tenant_isolation_shared_episodes ON shared_episodes
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_log') THEN
    CREATE POLICY tenant_isolation_activity_log ON activity_log
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_directives') THEN
    CREATE POLICY tenant_isolation_founder_directives ON founder_directives
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_assignments') THEN
    CREATE POLICY tenant_isolation_work_assignments ON work_assignments
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_messages') THEN
    CREATE POLICY tenant_isolation_agent_messages ON agent_messages
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_meetings') THEN
    CREATE POLICY tenant_isolation_agent_meetings ON agent_meetings
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_briefs') THEN
    CREATE POLICY tenant_isolation_agent_briefs ON agent_briefs
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_trust_scores') THEN
    CREATE POLICY tenant_isolation_agent_trust_scores ON agent_trust_scores
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drift_alerts') THEN
    CREATE POLICY tenant_isolation_drift_alerts ON drift_alerts
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_audit_log') THEN
    CREATE POLICY tenant_isolation_platform_audit_log ON platform_audit_log
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_constitutions') THEN
    CREATE POLICY tenant_isolation_agent_constitutions ON agent_constitutions
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;

-- System bypass policies (glyphor_system role bypasses RLS)

CREATE POLICY system_bypass_tenants ON tenants
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_tenant_workspaces ON tenant_workspaces
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_tenant_agents ON tenant_agents
  TO glyphor_system USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_runs') THEN
    CREATE POLICY system_bypass_agent_runs ON agent_runs
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_nodes') THEN
    CREATE POLICY system_bypass_kg_nodes ON kg_nodes
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_edges') THEN
    CREATE POLICY system_bypass_kg_edges ON kg_edges
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shared_episodes') THEN
    CREATE POLICY system_bypass_shared_episodes ON shared_episodes
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_log') THEN
    CREATE POLICY system_bypass_activity_log ON activity_log
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_directives') THEN
    CREATE POLICY system_bypass_founder_directives ON founder_directives
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_assignments') THEN
    CREATE POLICY system_bypass_work_assignments ON work_assignments
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_messages') THEN
    CREATE POLICY system_bypass_agent_messages ON agent_messages
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_meetings') THEN
    CREATE POLICY system_bypass_agent_meetings ON agent_meetings
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_briefs') THEN
    CREATE POLICY system_bypass_agent_briefs ON agent_briefs
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_trust_scores') THEN
    CREATE POLICY system_bypass_agent_trust_scores ON agent_trust_scores
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drift_alerts') THEN
    CREATE POLICY system_bypass_drift_alerts ON drift_alerts
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_audit_log') THEN
    CREATE POLICY system_bypass_platform_audit_log ON platform_audit_log
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_constitutions') THEN
    CREATE POLICY system_bypass_agent_constitutions ON agent_constitutions
      TO glyphor_system USING (true) WITH CHECK (true);
  END IF;
END $$;
