-- Normalize user_id to lowercase to prevent case-sensitivity mismatches
-- Historical data had both 'Andrew@glyphor.ai' and 'andrew@glyphor.ai'
-- which caused messages to be invisible when loading with lowercase aliases

UPDATE chat_messages SET user_id = LOWER(user_id) WHERE user_id != LOWER(user_id);

-- Add a check constraint to enforce lowercase going forward
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_user_id_lowercase
  CHECK (user_id = LOWER(user_id));
