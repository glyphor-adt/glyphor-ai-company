-- Add user_id to chat_messages so conversations are scoped per user
alter table chat_messages add column if not exists user_id text;

-- Backfill existing messages to kristina (the only user so far)
update chat_messages set user_id = 'kristina@glyphor.ai' where user_id is null;

-- Make it non-null going forward
alter table chat_messages alter column user_id set not null;

-- Index for per-user queries
create index if not exists idx_chat_messages_user_agent
  on chat_messages (user_id, agent_role, created_at desc);
