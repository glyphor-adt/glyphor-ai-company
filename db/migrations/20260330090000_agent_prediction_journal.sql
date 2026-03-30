BEGIN;

CREATE TABLE IF NOT EXISTS agent_prediction_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT COALESCE(
    NULLIF(current_setting('app.current_tenant', true), ''),
    '00000000-0000-0000-0000-000000000000'
  )::uuid REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  prediction_type TEXT NOT NULL,
  predicted_value JSONB NOT NULL DEFAULT 'null'::jsonb,
  target_date TIMESTAMPTZ NOT NULL,
  resolution_source TEXT NOT NULL,
  actual_value JSONB,
  accuracy_score REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prediction_journal_status_target
  ON agent_prediction_journal(status, target_date);

CREATE INDEX IF NOT EXISTS idx_prediction_journal_agent_status
  ON agent_prediction_journal(agent_role, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_journal_run_id
  ON agent_prediction_journal(run_id);

ALTER TABLE agent_prediction_journal ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'tenant_isolation_agent_prediction_journal'
      AND tablename = 'agent_prediction_journal'
  ) THEN
    CREATE POLICY tenant_isolation_agent_prediction_journal
      ON agent_prediction_journal
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;

COMMIT;