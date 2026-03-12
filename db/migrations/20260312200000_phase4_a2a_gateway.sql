-- Phase 4 A2A gateway: external client registry + task lifecycle.

CREATE TABLE IF NOT EXISTS a2a_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  trust_level TEXT NOT NULL DEFAULT 'untrusted'
    CHECK (trust_level IN ('untrusted', 'basic', 'trusted')),
  rate_limit_per_hour INT NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_a2a_clients_active
  ON a2a_clients(tenant_id, is_active)
  WHERE is_active = true;

ALTER TABLE a2a_clients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'a2a_clients'
      AND policyname = 'tenant_isolation_a2a_clients'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_a2a_clients ON a2a_clients
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'a2a_clients'
      AND policyname = 'system_bypass_a2a_clients'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_a2a_clients ON a2a_clients
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES a2a_clients(id),
  directive_id UUID REFERENCES founder_directives(id),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'working', 'completed', 'failed')),
  input JSONB NOT NULL,
  output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_client
  ON a2a_tasks(tenant_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status
  ON a2a_tasks(tenant_id, status, created_at DESC);

ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'a2a_tasks'
      AND policyname = 'tenant_isolation_a2a_tasks'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_a2a_tasks ON a2a_tasks
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'a2a_tasks'
      AND policyname = 'system_bypass_a2a_tasks'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_a2a_tasks ON a2a_tasks
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

ALTER TABLE founder_directives
  DROP CONSTRAINT IF EXISTS founder_directives_source_check;

ALTER TABLE founder_directives
  ADD CONSTRAINT founder_directives_source_check
  CHECK (source IN ('founder', 'agent_proposed', 'initiative_derived', 'external_a2a'));
