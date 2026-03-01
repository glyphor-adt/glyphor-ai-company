-- Multi-tenancy: Seed Glyphor as tenant 0 and backfill existing data

-- Insert Glyphor as the default tenant (tenant 0)
INSERT INTO tenants (id, name, slug, website, industry, product, status)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Glyphor',
  'glyphor',
  'https://glyphor.ai',
  'AI',
  'full',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Backfill all existing data with Glyphor tenant_id
UPDATE agent_runs SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE kg_nodes SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE kg_edges SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE shared_episodes SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE activity_log SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE founder_directives SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE work_assignments SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_messages SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_meetings SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_briefs SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_trust_scores SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE drift_alerts SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE platform_audit_log SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE agent_constitutions SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;

-- Add NOT NULL constraints on critical tables
ALTER TABLE agent_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE kg_nodes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE kg_edges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_briefs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE founder_directives ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE work_assignments ALTER COLUMN tenant_id SET NOT NULL;
