-- Run this if your project already has schema.sql without users table
create table if not exists users (
  id text primary key,
  full_name text not null,
  username text,
  role text not null,
  pin text not null,
  allowed_tabs jsonb default '[]',
  is_active boolean default true,
  created_at timestamptz,
  updated_at timestamptz
);

alter table users enable row level security;
drop policy if exists "anon all users" on users;
create policy "anon all users" on users for all using (true) with check (true);
