-- Multi-tenancy: Core tenant tables

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  website TEXT,
  industry TEXT,
  competitors JSONB DEFAULT '[]',
  brand_voice TEXT,
  product TEXT NOT NULL CHECK (product IN ('marketing', 'finance', 'research', 'operations', 'full')),
  status TEXT DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused', 'churned')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('slack', 'teams', 'email', 'webhook')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  workspace_external_id TEXT,
  channel_mapping JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform)
);

CREATE TABLE IF NOT EXISTS tenant_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT,
  model_tier TEXT DEFAULT 'gpt-4o-mini',
  brief_template TEXT NOT NULL,
  brief_compiled TEXT,
  delivery_channel TEXT,
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, agent_role)
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_product ON tenants(product);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_agents_tenant ON tenant_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_agents_active ON tenant_agents(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tenant_agents_schedule ON tenant_agents(last_run_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tenant_workspaces_tenant ON tenant_workspaces(tenant_id);
