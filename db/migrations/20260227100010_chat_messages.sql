-- Chat messages: persist founder ↔ agent conversations
create table if not exists chat_messages (
  id            uuid primary key default gen_random_uuid(),
  agent_role    text not null,
  role          text not null check (role in ('user', 'agent')),
  content       text not null,
  created_at    timestamptz not null default now()
);

create index idx_chat_messages_agent_role on chat_messages (agent_role, created_at desc);

-- RLS: allow dashboard (anon key) full access
alter table chat_messages enable row level security;
create policy "Allow all access to chat_messages"
  on chat_messages for all
  using (true)
  with check (true);
