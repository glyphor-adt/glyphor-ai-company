-- Canonical run session/event persistence for replayable runtime streams.
-- Bridge-safe: this coexists with chat_messages and agent_runs.

CREATE TABLE IF NOT EXISTS run_sessions (
  run_id TEXT PRIMARY KEY,
  conversation_id TEXT,
  user_id TEXT,
  agent_role TEXT NOT NULL,
  task TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'dashboard',
  transport TEXT NOT NULL DEFAULT 'json',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_run_sessions_conversation_started
  ON run_sessions (conversation_id, started_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_run_sessions_user_started
  ON run_sessions (user_id, started_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run_sessions(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  phase TEXT,
  status TEXT,
  payload JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT run_events_seq_unique UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
  ON run_events (run_id, seq ASC);

CREATE INDEX IF NOT EXISTS idx_run_events_run_created
  ON run_events (run_id, created_at ASC);
