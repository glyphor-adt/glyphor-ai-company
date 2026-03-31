BEGIN;

DO $$ BEGIN
  CREATE TYPE autonomy_level_change_type AS ENUM (
    'promoted',
    'demoted',
    'admin_override',
    'auto_promote',
    'auto_demote'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS autonomy_level_config (
  level INTEGER PRIMARY KEY CHECK (level BETWEEN 0 AND 4),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  execution_policy TEXT NOT NULL,
  review_policy TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autonomy_level_thresholds (
  level INTEGER PRIMARY KEY REFERENCES autonomy_level_config(level) ON DELETE CASCADE,
  completion_rate_threshold DOUBLE PRECISION,
  confidence_score_threshold DOUBLE PRECISION,
  escalation_rate_max DOUBLE PRECISION,
  contradiction_rate_max DOUBLE PRECISION,
  sla_breach_rate_max DOUBLE PRECISION,
  min_tasks_completed INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (level BETWEEN 0 AND 4)
);

CREATE TABLE IF NOT EXISTS agent_autonomy_config (
  agent_id TEXT PRIMARY KEY,
  current_level INTEGER NOT NULL DEFAULT 0 REFERENCES autonomy_level_config(level),
  max_allowed_level INTEGER NOT NULL DEFAULT 0 REFERENCES autonomy_level_config(level),
  auto_promote BOOLEAN NOT NULL DEFAULT TRUE,
  auto_demote BOOLEAN NOT NULL DEFAULT TRUE,
  promoted_at TIMESTAMPTZ,
  last_level_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_level_change_reason TEXT,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (current_level BETWEEN 0 AND 4),
  CHECK (max_allowed_level BETWEEN 0 AND 4),
  CHECK (current_level <= max_allowed_level)
);

CREATE TABLE IF NOT EXISTS autonomy_level_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  from_level INTEGER NOT NULL REFERENCES autonomy_level_config(level),
  to_level INTEGER NOT NULL REFERENCES autonomy_level_config(level),
  change_type autonomy_level_change_type NOT NULL,
  trust_score_at_change DOUBLE PRECISION,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  changed_by TEXT NOT NULL,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_level BETWEEN 0 AND 4),
  CHECK (to_level BETWEEN 0 AND 4)
);

CREATE INDEX IF NOT EXISTS idx_autonomy_thresholds_tenant
  ON autonomy_level_thresholds (tenant_id, level);

CREATE INDEX IF NOT EXISTS idx_agent_autonomy_level
  ON agent_autonomy_config (tenant_id, current_level, max_allowed_level);

CREATE INDEX IF NOT EXISTS idx_autonomy_history_agent
  ON autonomy_level_history (tenant_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomy_history_change_type
  ON autonomy_level_history (tenant_id, change_type, created_at DESC);

INSERT INTO autonomy_level_config (level, label, description, execution_policy, review_policy, metadata)
VALUES
  (0, 'Human Gate', 'All actions require human approval before execution.', 'all actions require human approval before execution', 'human review on every action', '{"seeded":true}'::jsonb),
  (1, 'Routine Auto', 'Routine actions auto, significant actions need one approval.', 'routine actions auto; significant actions require one approval', 'approval for significant actions', '{"seeded":true}'::jsonb),
  (2, 'Classified Auto', 'All pre-classified actions auto, novel action types need approval.', 'pre-classified actions auto; novel action types require approval', 'approval for novel actions', '{"seeded":true}'::jsonb),
  (3, 'Scoped Autonomy', 'Fully autonomous within role scope, human notified async.', 'fully autonomous inside role scope', 'async notification to human', '{"seeded":true}'::jsonb),
  (4, 'Full Autonomy', 'Fully autonomous, human reviews weekly summaries only.', 'fully autonomous execution', 'weekly summary review only', '{"seeded":true}'::jsonb)
ON CONFLICT (level) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    execution_policy = EXCLUDED.execution_policy,
    review_policy = EXCLUDED.review_policy,
    metadata = autonomy_level_config.metadata || EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO autonomy_level_thresholds (
  level,
  completion_rate_threshold,
  confidence_score_threshold,
  escalation_rate_max,
  contradiction_rate_max,
  sla_breach_rate_max,
  min_tasks_completed,
  metadata
)
VALUES
  (0, NULL, NULL, NULL, NULL, NULL, NULL, '{"seeded":true,"default_for_new_agent":true}'::jsonb),
  (1, 0.70, NULL, NULL, NULL, NULL, NULL, '{"seeded":true}'::jsonb),
  (2, 0.85, NULL, 0.20, NULL, NULL, NULL, '{"seeded":true}'::jsonb),
  (3, 0.93, NULL, 0.08, NULL, NULL, NULL, '{"seeded":true}'::jsonb),
  (4, 0.97, NULL, 0.03, NULL, NULL, 500, '{"seeded":true}'::jsonb)
ON CONFLICT (level) DO UPDATE
SET completion_rate_threshold = EXCLUDED.completion_rate_threshold,
    confidence_score_threshold = EXCLUDED.confidence_score_threshold,
    escalation_rate_max = EXCLUDED.escalation_rate_max,
    contradiction_rate_max = EXCLUDED.contradiction_rate_max,
    sla_breach_rate_max = EXCLUDED.sla_breach_rate_max,
    min_tasks_completed = EXCLUDED.min_tasks_completed,
    metadata = autonomy_level_thresholds.metadata || EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO agent_autonomy_config (
  agent_id,
  current_level,
  max_allowed_level,
  auto_promote,
  auto_demote,
  promoted_at,
  last_level_change_at,
  last_level_change_reason,
  metadata,
  created_at,
  updated_at
)
SELECT
  role,
  0,
  1,
  TRUE,
  TRUE,
  NULL,
  NOW(),
  'Seeded default autonomy policy',
  '{}'::jsonb,
  NOW(),
  NOW()
FROM company_agents
ON CONFLICT (agent_id) DO NOTHING;

CREATE OR REPLACE FUNCTION provision_agent_autonomy_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_autonomy_config (
    agent_id,
    current_level,
    max_allowed_level,
    auto_promote,
    auto_demote,
    last_level_change_at,
    last_level_change_reason,
    tenant_id,
    created_at,
    updated_at
  )
  VALUES (
    NEW.role,
    0,
    1,
    TRUE,
    TRUE,
    NOW(),
    'Auto-provisioned for new agent',
    COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'),
    NOW(),
    NOW()
  )
  ON CONFLICT (agent_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_agents_autonomy_config ON company_agents;
CREATE TRIGGER trg_company_agents_autonomy_config
AFTER INSERT ON company_agents
FOR EACH ROW
EXECUTE FUNCTION provision_agent_autonomy_config();

ALTER TABLE autonomy_level_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_level_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_autonomy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_level_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_autonomy_level_config ON autonomy_level_config
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_autonomy_level_thresholds ON autonomy_level_thresholds
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_agent_autonomy_config ON agent_autonomy_config
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY tenant_isolation_autonomy_level_history ON autonomy_level_history
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_autonomy_level_config ON autonomy_level_config
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_autonomy_level_thresholds ON autonomy_level_thresholds
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_agent_autonomy_config ON agent_autonomy_config
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY system_bypass_autonomy_level_history ON autonomy_level_history
    TO glyphor_system USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;