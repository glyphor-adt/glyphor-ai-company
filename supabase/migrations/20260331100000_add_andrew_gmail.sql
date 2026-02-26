-- Add andrew.zwelling@gmail.com to dashboard users
insert into dashboard_users (email, name, role, created_by)
values ('andrew.zwelling@gmail.com', 'Andrew Zwelling', 'admin', 'system')
on conflict (email) do nothing;
