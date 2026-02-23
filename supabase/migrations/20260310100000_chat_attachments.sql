-- Add attachments column to chat_messages for file metadata
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments jsonb;
