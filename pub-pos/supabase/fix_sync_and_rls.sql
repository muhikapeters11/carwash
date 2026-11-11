-- ============================================================
-- Run this AFTER schema.sql so the app can sync across devices
-- and login_with_pin can find crypt()
-- ============================================================

create extension if not exists "pgcrypto" with schema extensions;

-- Fix login function search_path so crypt() is found
create or replace function public.login_with_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec public.profiles%rowtype;
begin
  if p_pin is null or length(p_pin) <> 6 then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  select * into rec
  from public.profiles
  where is_active = true
    and pin_hash = crypt(p_pin, pin_hash)
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  return json_build_object(
    'ok', true,
    'user', json_build_object(
      'id', rec.id,
      'email', rec.email,
      'full_name', rec.full_name,
      'role', rec.role,
      'permissions', rec.permissions
    )
  );
end;
$$;

-- Allow RPCs from the web app (anon key)
grant execute on function public.set_profile_pin(uuid, text) to anon, authenticated, service_role;
grant execute on function public.login_with_pin(text) to anon, authenticated, service_role;
grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) to anon, authenticated, service_role;
grant execute on function public.record_credit_payment(uuid, numeric, uuid, text) to anon, authenticated, service_role;

-- Open tables for the POS (correct table names from schema.sql)
alter table if exists public.profiles enable row level security;
alter table if exists public.products enable row level security;
alter table if exists public.sales enable row level security;
alter table if exists public.sale_items enable row level security;
alter table if exists public.held_sales enable row level security;
alter table if exists public.credits enable row level security;
alter table if exists public.credit_payments enable row level security;
alter table if exists public.expenses enable row level security;
alter table if exists public.stock_receives enable row level security;
alter table if exists public.activity_logs enable row level security;
alter table if exists public.notifications enable row level security;
alter table if exists public.app_settings enable row level security;

-- Drop old policies if re-running
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','products','sales','sale_items','held_sales',
        'credits','credit_payments','expenses','stock_receives',
        'activity_logs','notifications','app_settings'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Permissive policies for POS (PIN auth is handled in the app)
create policy "pos_all_profiles" on public.profiles for all using (true) with check (true);
create policy "pos_all_products" on public.products for all using (true) with check (true);
create policy "pos_all_sales" on public.sales for all using (true) with check (true);
create policy "pos_all_sale_items" on public.sale_items for all using (true) with check (true);
create policy "pos_all_held" on public.held_sales for all using (true) with check (true);
create policy "pos_all_credits" on public.credits for all using (true) with check (true);
create policy "pos_all_credit_pay" on public.credit_payments for all using (true) with check (true);
create policy "pos_all_expenses" on public.expenses for all using (true) with check (true);
create policy "pos_all_receives" on public.stock_receives for all using (true) with check (true);
create policy "pos_all_activity" on public.activity_logs for all using (true) with check (true);
create policy "pos_all_notifications" on public.notifications for all using (true) with check (true);
create policy "pos_all_settings" on public.app_settings for all using (true) with check (true);

-- Table grants
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
