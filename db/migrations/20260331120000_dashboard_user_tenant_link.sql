-- Link dashboard users to a tenant so the dashboard can resolve organization-level view settings.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_tenant_id
  ON dashboard_users(tenant_id);

UPDATE dashboard_users
   SET tenant_id = COALESCE(
     tenant_id,
     (SELECT id
        FROM tenants
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1)
   )
 WHERE tenant_id IS NULL;