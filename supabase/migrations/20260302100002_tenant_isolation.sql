-- Multi-tenancy: Add tenant_id to existing tables for tenant isolation
-- Uses DO blocks to skip tables that may not exist yet

DO $$ BEGIN
  -- agent_runs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_runs') THEN
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id);
  END IF;

  -- kg_nodes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_nodes') THEN
    ALTER TABLE kg_nodes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_kg_nodes_tenant ON kg_nodes(tenant_id);
  END IF;

  -- kg_edges
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kg_edges') THEN
    ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_tenant ON kg_edges(tenant_id);
  END IF;

  -- shared_episodes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shared_episodes') THEN
    ALTER TABLE shared_episodes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_shared_episodes_tenant ON shared_episodes(tenant_id);
  END IF;

  -- activity_log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_log') THEN
    ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id);
  END IF;

  -- founder_directives
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_directives') THEN
    ALTER TABLE founder_directives ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_founder_directives_tenant ON founder_directives(tenant_id);
  END IF;

  -- work_assignments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_assignments') THEN
    ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant ON work_assignments(tenant_id);
  END IF;

  -- agent_messages
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_messages') THEN
    ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_tenant ON agent_messages(tenant_id);
  END IF;

  -- agent_meetings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_meetings') THEN
    ALTER TABLE agent_meetings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_meetings_tenant ON agent_meetings(tenant_id);
  END IF;

  -- agent_briefs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_briefs') THEN
    ALTER TABLE agent_briefs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_briefs_tenant ON agent_briefs(tenant_id);
  END IF;

  -- agent_trust_scores
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_trust_scores') THEN
    ALTER TABLE agent_trust_scores ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_trust_scores_tenant ON agent_trust_scores(tenant_id);
  END IF;

  -- drift_alerts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'drift_alerts') THEN
    ALTER TABLE drift_alerts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_drift_alerts_tenant ON drift_alerts(tenant_id);
  END IF;

  -- platform_audit_log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_audit_log') THEN
    ALTER TABLE platform_audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_log_tenant ON platform_audit_log(tenant_id);
  END IF;

  -- agent_constitutions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_constitutions') THEN
    ALTER TABLE agent_constitutions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX IF NOT EXISTS idx_agent_constitutions_tenant ON agent_constitutions(tenant_id);
  END IF;
END $$;
