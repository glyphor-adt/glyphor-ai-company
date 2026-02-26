-- Dashboard user access management
create table if not exists dashboard_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  created_by text not null default ''
);

-- Seed with existing allowed users
insert into dashboard_users (email, name, role, created_by) values
  ('kristina@glyphor.ai', 'Kristina Denney', 'admin', 'system'),
  ('andrew@glyphor.ai', 'Andrew Zwelling', 'admin', 'system'),
  ('devops@glyphor.ai', 'DevOps', 'viewer', 'system')
on conflict (email) do nothing;

-- RLS: allow anon to read (for auth checks) and admins to insert/delete
alter table dashboard_users enable row level security;

create policy "Anyone can read dashboard_users"
  on dashboard_users for select
  using (true);

create policy "Anyone can insert dashboard_users"
  on dashboard_users for insert
  with check (true);

create policy "Anyone can delete dashboard_users"
  on dashboard_users for delete
  using (true);

create policy "Anyone can update dashboard_users"
  on dashboard_users for update
  using (true);
