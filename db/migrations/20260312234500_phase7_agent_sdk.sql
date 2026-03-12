-- Phase 7: client-side Agent SDK support.
-- Extends dynamic agents with tenant/source metadata and creates
-- audit columns so SDK-created agents can be tracked end-to-end.

ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE company_agents
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE company_agents
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE company_agents
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT 'internal';

ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS created_by_client_id UUID REFERENCES a2a_clients(id);

ALTER TABLE company_agents
  ADD COLUMN IF NOT EXISTS authority_scope TEXT DEFAULT 'green';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_agents_created_via_check'
  ) THEN
    ALTER TABLE company_agents
      ADD CONSTRAINT company_agents_created_via_check
      CHECK (created_via IN ('internal', 'client_sdk'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_agents_authority_scope_check'
  ) THEN
    ALTER TABLE company_agents
      ADD CONSTRAINT company_agents_authority_scope_check
      CHECK (authority_scope IN ('green', 'yellow', 'red'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_company_agents_tenant
  ON company_agents(tenant_id, created_via, status);

CREATE INDEX IF NOT EXISTS idx_company_agents_client
  ON company_agents(created_by_client_id)
  WHERE created_by_client_id IS NOT NULL;

ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE agent_profiles
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE agent_profiles
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE agent_profiles
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_profiles_tenant
  ON agent_profiles(tenant_id, agent_id);

ALTER TABLE agent_schedules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

ALTER TABLE agent_schedules
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE agent_schedules
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE agent_schedules
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_schedules_tenant
  ON agent_schedules(tenant_id, agent_id);

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'internal';

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES a2a_clients(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_runs_source_check'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_source_check
      CHECK (source IN ('internal', 'client_sdk'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_source
  ON agent_runs(source, client_id, started_at DESC);
