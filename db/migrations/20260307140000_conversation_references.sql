-- Persist Bot Framework conversation references for proactive messaging.
-- Keyed by user AAD Object ID; stores the service URL, conversation ID,
-- and pairwise-encrypted user ID needed to send proactive DMs.

CREATE TABLE IF NOT EXISTS conversation_references (
  user_aad_id    TEXT PRIMARY KEY,
  service_url    TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  bot_id         TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allow the system role full access (no RLS — this is cross-tenant infra).
GRANT ALL ON conversation_references TO glyphor_system;
