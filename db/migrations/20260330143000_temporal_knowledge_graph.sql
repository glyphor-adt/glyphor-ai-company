BEGIN;

CREATE TABLE IF NOT EXISTS kg_entity_type_config (
  entity_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  classification_level data_classification_level NOT NULL DEFAULT 'internal',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_entity_type_config
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE kg_entity_type_config
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE kg_entity_type_config
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE kg_entity_type_config
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kg_entity_type_config_tenant
  ON kg_entity_type_config(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS kg_edge_type_config (
  edge_type TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_edge_type_config
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE kg_edge_type_config
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE kg_edge_type_config
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE kg_edge_type_config
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kg_edge_type_config_tenant
  ON kg_edge_type_config(tenant_id, is_active);

INSERT INTO kg_entity_type_config (entity_type, display_name, classification_level, metadata)
VALUES
  ('customer', 'Customer', 'internal', '{"seeded":true}'::jsonb),
  ('employee', 'Employee', 'internal', '{"seeded":true}'::jsonb),
  ('product', 'Product', 'internal', '{"seeded":true}'::jsonb),
  ('decision', 'Decision', 'internal', '{"seeded":true}'::jsonb),
  ('process', 'Process', 'internal', '{"seeded":true}'::jsonb),
  ('deal', 'Deal', 'internal', '{"seeded":true}'::jsonb),
  ('campaign', 'Campaign', 'internal', '{"seeded":true}'::jsonb),
  ('budget', 'Budget', 'internal', '{"seeded":true}'::jsonb),
  ('vendor', 'Vendor', 'internal', '{"seeded":true}'::jsonb),
  ('agent', 'Agent', 'internal', '{"seeded":true}'::jsonb)
ON CONFLICT (entity_type) DO UPDATE
SET display_name = EXCLUDED.display_name,
    classification_level = EXCLUDED.classification_level,
    metadata = kg_entity_type_config.metadata || EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO kg_edge_type_config (edge_type, display_name, metadata)
VALUES
  ('influences', 'Influences', '{"seeded":true}'::jsonb),
  ('depends_on', 'Depends On', '{"seeded":true}'::jsonb),
  ('supersedes', 'Supersedes', '{"seeded":true}'::jsonb),
  ('created_by', 'Created By', '{"seeded":true}'::jsonb),
  ('approved_by', 'Approved By', '{"seeded":true}'::jsonb),
  ('conflicts_with', 'Conflicts With', '{"seeded":true}'::jsonb)
ON CONFLICT (edge_type) DO UPDATE
SET display_name = EXCLUDED.display_name,
    metadata = kg_edge_type_config.metadata || EXCLUDED.metadata,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS kg_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  entity_type TEXT NOT NULL REFERENCES kg_entity_type_config(entity_type),
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_agent_id TEXT NOT NULL,
  UNIQUE (tenant_id, entity_type, entity_id)
);

ALTER TABLE kg_entities
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS embedding VECTOR(768),
  ADD COLUMN IF NOT EXISTS updated_by_agent_id TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE kg_entities
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000',
  ALTER COLUMN properties SET DEFAULT '{}'::jsonb;

UPDATE kg_entities
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE kg_entities
SET entity_id = COALESCE(entity_key, id::text)
WHERE entity_id IS NULL;

UPDATE kg_entities
SET name = COALESCE(display_name, entity_key, entity_id, id::text)
WHERE name IS NULL;

UPDATE kg_entities
SET properties = COALESCE(metadata, '{}'::jsonb)
WHERE properties IS NULL;

UPDATE kg_entities
SET updated_by_agent_id = 'system'
WHERE updated_by_agent_id IS NULL;

ALTER TABLE kg_entities
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN entity_id SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN properties SET NOT NULL,
  ALTER COLUMN updated_by_agent_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE kg_entities
    ADD CONSTRAINT kg_entities_tenant_entity_key_unique UNIQUE (tenant_id, entity_type, entity_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_kg_entities_type
  ON kg_entities(tenant_id, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kg_entities_name
  ON kg_entities(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_kg_entities_properties
  ON kg_entities USING gin(properties);
CREATE INDEX IF NOT EXISTS idx_kg_entities_embedding
  ON kg_entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS kg_edges_temporal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  from_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  to_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL REFERENCES kg_edge_type_config(edge_type),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_agent_id TEXT NOT NULL,
  UNIQUE (tenant_id, from_entity_id, to_entity_id, edge_type)
);

ALTER TABLE kg_edges_temporal
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by_agent_id TEXT;

ALTER TABLE kg_edges_temporal
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000',
  ALTER COLUMN properties SET DEFAULT '{}'::jsonb;

UPDATE kg_edges_temporal
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE kg_edges_temporal
SET created_by_agent_id = 'system'
WHERE created_by_agent_id IS NULL;

ALTER TABLE kg_edges_temporal
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN properties SET NOT NULL,
  ALTER COLUMN created_by_agent_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE kg_edges_temporal
    ADD CONSTRAINT kg_edges_temporal_unique UNIQUE (tenant_id, from_entity_id, to_entity_id, edge_type);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_kg_edges_temporal_from
  ON kg_edges_temporal(tenant_id, from_entity_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_temporal_to
  ON kg_edges_temporal(tenant_id, to_entity_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_temporal_type
  ON kg_edges_temporal(tenant_id, edge_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kg_edges_temporal_properties
  ON kg_edges_temporal USING gin(properties);

CREATE TABLE IF NOT EXISTS kg_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  confidence FLOAT NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_agent_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_facts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE kg_facts
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000';

UPDATE kg_facts
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

ALTER TABLE kg_facts
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kg_facts_entity_key_current
  ON kg_facts(tenant_id, entity_id, fact_key)
  WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_facts_entity_validity
  ON kg_facts(tenant_id, entity_id, valid_from DESC, valid_until);
CREATE INDEX IF NOT EXISTS idx_kg_facts_source
  ON kg_facts(tenant_id, source_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kg_facts_value
  ON kg_facts USING gin(fact_value);

CREATE TABLE IF NOT EXISTS kg_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  agent_id TEXT NOT NULL,
  query_type TEXT NOT NULL,
  entities_accessed JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kg_access_log
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS entities_accessed JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE kg_access_log
  ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000000',
  ALTER COLUMN entities_accessed SET DEFAULT '[]'::jsonb;

UPDATE kg_access_log
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

UPDATE kg_access_log
SET entities_accessed = '[]'::jsonb
WHERE entities_accessed IS NULL;

ALTER TABLE kg_access_log
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN entities_accessed SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kg_access_log_agent
  ON kg_access_log(tenant_id, agent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_kg_access_log_query_type
  ON kg_access_log(tenant_id, query_type, timestamp DESC);

INSERT INTO data_classifications (mcp_domain, resource_type, classification_level)
SELECT 'temporal_knowledge_graph', entity_type, classification_level
FROM kg_entity_type_config
ON CONFLICT (mcp_domain, resource_type) DO UPDATE
SET classification_level = EXCLUDED.classification_level;

INSERT INTO data_classifications (mcp_domain, resource_type, classification_level)
VALUES ('temporal_knowledge_graph', '__all__', 'internal')
ON CONFLICT (mcp_domain, resource_type) DO UPDATE
SET classification_level = EXCLUDED.classification_level;

INSERT INTO abac_policies (agent_role_id, mcp_domain, resource_type, classification_level, permission, priority)
SELECT ar.id, 'temporal_knowledge_graph', NULL, 'internal'::data_classification_level, 'allow'::abac_permission, 25
FROM agent_roles ar
ON CONFLICT DO NOTHING;

ALTER TABLE kg_entity_type_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edge_type_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edges_temporal ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_access_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_entity_type_config ON kg_entity_type_config
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_edge_type_config ON kg_edge_type_config
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_entities ON kg_entities
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_edges_temporal ON kg_edges_temporal
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_facts ON kg_facts
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_kg_access_log ON kg_access_log
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_entity_type_config ON kg_entity_type_config
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_edge_type_config ON kg_edge_type_config
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_entities ON kg_entities
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_edges_temporal ON kg_edges_temporal
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_facts ON kg_facts
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_kg_access_log ON kg_access_log
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;