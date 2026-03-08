-- Core initiatives + deliverables schema
-- Uses tenant_id to match the repository's multi-tenant pattern.

CREATE TABLE IF NOT EXISTS initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_initiative_id UUID UNIQUE REFERENCES proposed_initiatives(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  doctrine_alignment TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'active', 'completed', 'rejected')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  dependencies UUID[] NOT NULL DEFAULT '{}',
  target_date TIMESTAMPTZ,
  success_criteria TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  progress_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_initiatives_owner ON initiatives(tenant_id, owner_role);
CREATE INDEX IF NOT EXISTS idx_initiatives_dependencies ON initiatives USING GIN(dependencies);

ALTER TABLE initiatives ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'initiatives'
      AND policyname = 'tenant_isolation_initiatives'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_initiatives ON initiatives
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'initiatives'
      AND policyname = 'system_bypass_initiatives'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_initiatives ON initiatives
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

ALTER TABLE founder_directives
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id);

ALTER TABLE founder_directives
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE founder_directives
SET source = 'founder'
WHERE source IS NULL;

ALTER TABLE founder_directives
  ALTER COLUMN source SET DEFAULT 'founder';

ALTER TABLE founder_directives
  ALTER COLUMN source SET NOT NULL;

ALTER TABLE founder_directives
  DROP CONSTRAINT IF EXISTS founder_directives_source_check;

ALTER TABLE founder_directives
  ADD CONSTRAINT founder_directives_source_check
  CHECK (source IN ('founder', 'agent_proposed', 'initiative_derived'));

CREATE INDEX IF NOT EXISTS idx_directives_initiative
  ON founder_directives(initiative_id)
  WHERE initiative_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID REFERENCES initiatives(id),
  directive_id UUID REFERENCES founder_directives(id),
  assignment_id UUID REFERENCES work_assignments(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('document', 'design_asset', 'code', 'dataset', 'strategy', 'campaign')),
  content TEXT,
  storage_url TEXT,
  producing_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'superseded')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  consumed_by TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  CONSTRAINT deliverables_parent_reference_check
    CHECK (initiative_id IS NOT NULL OR directive_id IS NOT NULL OR assignment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_deliverables_initiative ON deliverables(initiative_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_type ON deliverables(tenant_id, type, status);
CREATE INDEX IF NOT EXISTS idx_deliverables_directive ON deliverables(directive_id) WHERE directive_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliverables_assignment ON deliverables(assignment_id) WHERE assignment_id IS NOT NULL;

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deliverables'
      AND policyname = 'tenant_isolation_deliverables'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_deliverables ON deliverables
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deliverables'
      AND policyname = 'system_bypass_deliverables'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_deliverables ON deliverables
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;
