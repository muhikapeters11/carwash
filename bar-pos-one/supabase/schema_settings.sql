create table if not exists app_settings (
  id text primary key,
  payload jsonb,
  updated_at timestamptz
);
alter table app_settings enable row level security;
drop policy if exists "anon all app_settings" on app_settings;
create policy "anon all app_settings" on app_settings for all using (true) with check (true);
