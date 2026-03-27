-- Migration: Add tenant_id + RLS to tables that were missed in the original
-- tenant isolation migration (20260302100003).
--
-- Tables affected:
--   fleet_findings      — no tenant_id
--   agent_tool_grants   — no tenant_id
--   agent_world_model   — no tenant_id
--   agent_memory        — no tenant_id
--   (agent_schedules already has tenant_id but no RLS policy)
--
-- Note: agent_tool_risk is a VIEW, not a table — it inherits
-- tenant isolation from its underlying base tables.
--
-- All existing rows are backfilled to the Glyphor tenant
-- (00000000-0000-0000-0000-000000000000).

BEGIN;

-- ── 1. Add tenant_id columns ────────────────────────────────────

ALTER TABLE fleet_findings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE agent_tool_grants
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE agent_world_model
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- ── 2. Backfill existing rows to Glyphor tenant ────────────────

UPDATE fleet_findings
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

UPDATE agent_tool_grants
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

UPDATE agent_world_model
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

UPDATE agent_memory
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

-- Backfill agent_schedules too (already has the column)
UPDATE agent_schedules
   SET tenant_id = '00000000-0000-0000-0000-000000000000'
 WHERE tenant_id IS NULL;

-- ── 3. Set NOT NULL after backfill ──────────────────────────────

ALTER TABLE fleet_findings
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE agent_tool_grants
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE agent_world_model
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE agent_memory
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE agent_schedules
  ALTER COLUMN tenant_id SET NOT NULL;

-- ── 4. Enable Row-Level Security ────────────────────────────────

ALTER TABLE fleet_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_world_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules ENABLE ROW LEVEL SECURITY;

-- ── 5. Tenant isolation policies (app-level) ────────────────────

CREATE POLICY tenant_isolation_fleet_findings ON fleet_findings
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_tool_grants ON agent_tool_grants
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_world_model ON agent_world_model
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_memory ON agent_memory
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_agent_schedules ON agent_schedules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 6. System bypass policies (glyphor_system) ──────────────────

CREATE POLICY system_bypass_fleet_findings ON fleet_findings
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_tool_grants ON agent_tool_grants
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_world_model ON agent_world_model
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_memory ON agent_memory
  TO glyphor_system USING (true) WITH CHECK (true);

CREATE POLICY system_bypass_agent_schedules ON agent_schedules
  TO glyphor_system USING (true) WITH CHECK (true);

-- ── 7. Indexes for tenant_id lookups ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fleet_findings_tenant
  ON fleet_findings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_tool_grants_tenant
  ON agent_tool_grants (tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_world_model_tenant
  ON agent_world_model (tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant
  ON agent_memory (tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_tenant
  ON agent_schedules (tenant_id);

COMMIT;
