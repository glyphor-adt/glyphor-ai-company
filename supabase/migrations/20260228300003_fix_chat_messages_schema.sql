-- ═══════════════════════════════════════════════════════════════════
-- Migration: Fix chat_messages schema for persistence
-- Date: 2026-02-28
--
-- The dashboard Chat page expects user_id and attachments columns
-- but they were never added to the schema. This caused all INSERT
-- and SELECT queries to silently fail, losing chat history.
-- ═══════════════════════════════════════════════════════════════════

-- Add user_id to scope messages per user
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'unknown';

-- Add attachments metadata (file names + types, not binary data)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB;

-- Index for loading per-user chat history quickly
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_agent
  ON chat_messages (user_id, agent_role, created_at DESC);
