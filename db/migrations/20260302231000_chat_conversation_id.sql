-- Add conversation_id to chat_messages for shared group conversations.
-- Group chat messages share a conversation_id so all participants see the same thread.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;
