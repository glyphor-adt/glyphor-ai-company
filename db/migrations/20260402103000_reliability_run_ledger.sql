BEGIN;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_seq BIGINT NOT NULL,
  event_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  trigger TEXT,
  component TEXT NOT NULL,
  trace_id TEXT,
  parent_event_uid TEXT,
  approval_state TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_digest TEXT NOT NULL,
  prev_event_digest TEXT,
  event_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, event_seq),
  UNIQUE (event_uid)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_seq
  ON agent_run_events (run_id, event_seq ASC);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_type_created
  ON agent_run_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  evidence_uid TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_tool TEXT,
  source_ref TEXT,
  content_digest TEXT NOT NULL,
  content_preview TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_evidence_run_created
  ON agent_run_evidence (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_claim_evidence_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  claim_uid TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  evidence_uid TEXT NOT NULL REFERENCES agent_run_evidence(evidence_uid) ON DELETE CASCADE,
  verification_state TEXT NOT NULL DEFAULT 'supported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (claim_uid, evidence_uid)
);

CREATE INDEX IF NOT EXISTS idx_agent_claim_links_run_created
  ON agent_claim_evidence_links (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_failure_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  task_class TEXT NOT NULL,
  failure_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_failure_taxonomy_task
  ON agent_failure_taxonomy (task_class, failure_code, created_at DESC);

COMMIT;
