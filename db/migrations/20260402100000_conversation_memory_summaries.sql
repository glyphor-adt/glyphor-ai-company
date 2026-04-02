BEGIN;

CREATE TABLE IF NOT EXISTS conversation_memory_summaries (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  agent_role TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_turn_count INTEGER NOT NULL DEFAULT 0,
  source_tool_count INTEGER NOT NULL DEFAULT 0,
  source_token_estimate INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE conversation_memory_summaries
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS agent_role TEXT,
  ADD COLUMN IF NOT EXISTS summary_text TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS source_turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_tool_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_token_estimate INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_memory_summaries_conversation
  ON conversation_memory_summaries (conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_summaries_updated
  ON conversation_memory_summaries (updated_at DESC);

COMMIT;

