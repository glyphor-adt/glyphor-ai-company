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

ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS primary_agent_role TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS latest_run_id TEXT;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_sessions ALTER COLUMN session_key SET NOT NULL;
ALTER TABLE run_sessions ALTER COLUMN source SET NOT NULL;
ALTER TABLE run_sessions ALTER COLUMN primary_agent_role SET NOT NULL;
ALTER TABLE run_sessions ALTER COLUMN status SET NOT NULL;
ALTER TABLE run_sessions ALTER COLUMN status SET DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'run_sessions_status_check'
      AND conrelid = 'run_sessions'::regclass
  ) THEN
    ALTER TABLE run_sessions
      ADD CONSTRAINT run_sessions_status_check
      CHECK (status IN ('active','completed','failed','aborted','expired'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_sessions_session_key_unique
  ON run_sessions (session_key);

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

ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS attempt_number INTEGER;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS triggered_by TEXT;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS trigger_reason TEXT;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS response_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_attempts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_attempts ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE run_attempts ALTER COLUMN attempt_number SET NOT NULL;
ALTER TABLE run_attempts ALTER COLUMN triggered_by SET NOT NULL;
ALTER TABLE run_attempts ALTER COLUMN status SET NOT NULL;
ALTER TABLE run_attempts ALTER COLUMN status SET DEFAULT 'created';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'run_attempts_status_check'
      AND conrelid = 'run_attempts'::regclass
  ) THEN
    ALTER TABLE run_attempts
      ADD CONSTRAINT run_attempts_status_check
      CHECK (status IN ('created','running','completed','failed','aborted','queued_for_approval','rejected'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_attempts_session_attempt_unique
  ON run_attempts (session_id, attempt_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_attempts_run_id_unique
  ON run_attempts (run_id);

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

ALTER TABLE run_events ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS attempt_id UUID;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS event_seq BIGINT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS stream_seq BIGINT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS tool_name TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS parent_event_id TEXT;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE run_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE run_events ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE run_events ALTER COLUMN attempt_id SET NOT NULL;
ALTER TABLE run_events ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE run_events ALTER COLUMN stream_seq SET NOT NULL;
ALTER TABLE run_events ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE run_events ALTER COLUMN event_type SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_attempt_stream_unique
  ON run_events (attempt_id, stream_seq);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id_unique
  ON run_events (event_id);

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
