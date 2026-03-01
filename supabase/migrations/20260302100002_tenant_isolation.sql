-- Multi-tenancy: Add tenant_id to existing tables for tenant isolation

-- agent_runs
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id);

-- kg_nodes
ALTER TABLE kg_nodes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_tenant ON kg_nodes(tenant_id);

-- kg_edges
ALTER TABLE kg_edges ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tenant ON kg_edges(tenant_id);

-- shared_episodes
ALTER TABLE shared_episodes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_shared_episodes_tenant ON shared_episodes(tenant_id);

-- activity_log
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id);

-- founder_directives
ALTER TABLE founder_directives ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_founder_directives_tenant ON founder_directives(tenant_id);

-- work_assignments
ALTER TABLE work_assignments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant ON work_assignments(tenant_id);

-- agent_messages
ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_tenant ON agent_messages(tenant_id);

-- agent_meetings
ALTER TABLE agent_meetings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_meetings_tenant ON agent_meetings(tenant_id);

-- agent_briefs
ALTER TABLE agent_briefs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_briefs_tenant ON agent_briefs(tenant_id);

-- agent_trust_scores
ALTER TABLE agent_trust_scores ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_trust_scores_tenant ON agent_trust_scores(tenant_id);

-- drift_alerts
ALTER TABLE drift_alerts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_drift_alerts_tenant ON drift_alerts(tenant_id);

-- platform_audit_log
ALTER TABLE platform_audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_tenant ON platform_audit_log(tenant_id);

-- agent_constitutions
ALTER TABLE agent_constitutions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agent_constitutions_tenant ON agent_constitutions(tenant_id);
