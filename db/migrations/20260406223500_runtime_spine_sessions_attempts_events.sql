BEGIN;

CREATE TABLE IF NOT EXISTS run_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  owner_user_id TEXT,
  owner_email TEXT,
  tenant_id UUID,
  primary_agent_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  latest_run_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT run_sessions_status_check CHECK (status IN ('active','completed','failed','aborted','expired'))
);

CREATE INDEX IF NOT EXISTS idx_run_sessions_source_started
  ON run_sessions (source, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_sessions_owner
  ON run_sessions (owner_email, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_sessions_agent
  ON run_sessions (primary_agent_role, started_at DESC);

CREATE TABLE IF NOT EXISTS run_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES run_sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,
  trigger_reason TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'created',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, attempt_number),
  UNIQUE (run_id),
  CONSTRAINT run_attempts_status_check CHECK (status IN ('created','running','completed','failed','aborted','queued_for_approval','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_run_attempts_session_started
  ON run_attempts (session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_attempts_status_started
  ON run_attempts (status, started_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES run_sessions(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES run_attempts(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  event_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  stream_seq BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT,
  actor_role TEXT,
  tool_name TEXT,
  trace_id TEXT,
  parent_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, stream_seq),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_run_events_session_seq
  ON run_events (session_id, stream_seq ASC);

CREATE INDEX IF NOT EXISTS idx_run_events_attempt_seq
  ON run_events (attempt_id, stream_seq ASC);

CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
  ON run_events (run_id, stream_seq ASC);

CREATE INDEX IF NOT EXISTS idx_run_events_type_ts
  ON run_events (event_type, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_run_events_created
  ON run_events (created_at DESC);

COMMIT;
