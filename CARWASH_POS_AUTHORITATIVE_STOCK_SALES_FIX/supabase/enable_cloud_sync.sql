-- Run once: branding column + realtime for instant multi-device updates

alter table public.app_settings
  add column if not exists login_bg_url text;

alter table public.app_settings enable row level security;
drop policy if exists "pos_all_settings" on public.app_settings;
create policy "pos_all_settings" on public.app_settings for all using (true) with check (true);
grant select, insert, update on public.app_settings to anon, authenticated;

-- Realtime publication (ignore errors if already added)
do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.sales;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.sale_items;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.stock_receives;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.credits;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.held_sales;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.activity_logs;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.credit_payments;
exception when duplicate_object then null; when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when others then null;
end $$;

notify pgrst, 'reload schema';
