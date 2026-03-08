-- Ora chat sessions: enables multi-conversation support like Claude/ChatGPT.
-- Each session has a title (auto-generated from first message), tracks user_id,
-- and links to chat_messages via session_id.

CREATE TABLE IF NOT EXISTS ora_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ora_sessions_user
  ON ora_sessions (user_id, updated_at DESC);

-- Add session_id to chat_messages to link messages to sessions.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (session_id, created_at ASC)
  WHERE session_id IS NOT NULL;
