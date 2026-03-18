-- Align schema with smoke-layer expectations after tenant and governance rollout changes.

-- 1) Ensure decision_approvals is migration-managed (previously runtime-created by scheduler).
CREATE TABLE IF NOT EXISTS decision_approvals (
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  founder TEXT NOT NULL,
  approved BOOLEAN NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (decision_id, founder)
);

CREATE INDEX IF NOT EXISTS idx_decision_approvals_decision
  ON decision_approvals(decision_id, created_at DESC);

-- 2) Ensure post-rollout tenant tables default to the Glyphor system tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_knowledge'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'ALTER TABLE customer_knowledge ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000000''::uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_tenants'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'ALTER TABLE customer_tenants ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000000''::uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_content'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'ALTER TABLE customer_content ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000000''::uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'slack_approvals'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'ALTER TABLE slack_approvals ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000000''::uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'slack_routing_rules'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'ALTER TABLE slack_routing_rules ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000000''::uuid';
  END IF;
END $$;