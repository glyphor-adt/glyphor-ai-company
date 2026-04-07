-- Microsoft tenant binding hardening:
-- 1. Track whether a Teams install has been verified against a configured Glyphor tenant workspace
-- 2. Persist install proof separately from the internal tenant binding
-- 3. Add lookup support for verified Teams workspace resolution

ALTER TABLE customer_tenants
  ADD COLUMN IF NOT EXISTS teams_binding_status TEXT
    CHECK (teams_binding_status IN ('pending', 'verified', 'mismatch')),
  ADD COLUMN IF NOT EXISTS teams_binding_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teams_binding_workspace_key TEXT,
  ADD COLUMN IF NOT EXISTS teams_binding_proof JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE customer_tenants
SET teams_binding_status = 'pending'
WHERE teams_tenant_id IS NOT NULL
  AND teams_binding_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_tenants_teams_binding_status
  ON customer_tenants (teams_binding_status)
  WHERE teams_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_workspaces_platform_external
  ON tenant_workspaces (platform, workspace_external_id)
  WHERE workspace_external_id IS NOT NULL;
