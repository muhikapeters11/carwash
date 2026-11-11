-- Pub POS: reliable cloud PIN login + safe factory reset migration.
-- Run this entire file once in Supabase SQL Editor.
-- It preserves the administrator who confirms reset and never TRUNCATEs
-- tables with CASCADE (which can unexpectedly clear referenced records).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.app_settings add column if not exists login_bg_url text;
alter table public.app_settings add column if not exists factory_reset_at timestamptz;

-- Authoritative cloud PIN login. pgcrypto may be installed in either public
-- or extensions on an existing project; both are in this function's path.
create or replace function public.login_with_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  rec public.profiles%rowtype;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  select p.* into rec
  from public.profiles p
  where p.is_active is true
    and p.pin_hash is not null
    and p.pin_hash = crypt(p_pin, p.pin_hash)
  order by case when p.role = 'admin' then 0 else 1 end, p.created_at asc
  limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'Invalid PIN');
  end if;

  return json_build_object(
    'ok', true,
    'user', json_build_object(
      'id', rec.id,
      'email', coalesce(rec.email, ''),
      'full_name', coalesce(rec.full_name, 'User'),
      'role', rec.role,
      'permissions', coalesce(rec.permissions, array[]::text[])
    )
  );
end;
$$;

revoke all on function public.login_with_pin(text) from public;
grant execute on function public.login_with_pin(text) to anon, authenticated, service_role;

-- Keep PIN changes and new cashier creation compatible when pgcrypto lives
-- in extensions rather than public. The UI must check the returned ok flag.
create or replace function public.set_profile_pin(p_id uuid, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_id is null or p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return json_build_object('ok', false, 'error', 'PIN must be exactly six digits');
  end if;
  update public.profiles
  set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_id;
  if not found then
    return json_build_object('ok', false, 'error', 'User profile not found');
  end if;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.set_profile_pin(uuid, text) from public;
grant execute on function public.set_profile_pin(uuid, text) to anon, authenticated, service_role;

-- Replace old one-argument reset RPC; the app calls the two-argument version.
drop function if exists public.factory_reset_cloud(text);

create or replace function public.factory_reset_cloud(p_pin text, p_admin_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  admin_row public.profiles%rowtype;
  child record;
  reset_time timestamptz := clock_timestamp();
  products_deleted bigint := 0;
  sales_deleted bigint := 0;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or p_admin_id is null then
    return json_build_object('ok', false, 'error', 'Enter the six-digit administrator PIN and sign in again.');
  end if;

  select p.* into admin_row
  from public.profiles p
  where p.id = p_admin_id
    and p.role = 'admin'
    and p.is_active is true
    and p.pin_hash = crypt(p_pin, p.pin_hash)
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Administrator PIN is incorrect or the account is inactive.');
  end if;

  select count(*) into products_deleted from public.products;
  select count(*) into sales_deleted from public.sales;

  -- DELETE in dependency order. Unlike TRUNCATE ... CASCADE, DELETE does not
  -- cascade from a child table to the profiles table it references.
  -- WHERE true satisfies safe-update / "DELETE requires a WHERE clause" guards.
  if to_regclass('public.credit_payments') is not null then delete from public.credit_payments where true; end if;
  if to_regclass('public.credits') is not null then delete from public.credits where true; end if;
  if to_regclass('public.sale_items') is not null then delete from public.sale_items where true; end if;
  if to_regclass('public.sales') is not null then delete from public.sales where true; end if;
  if to_regclass('public.held_sales') is not null then delete from public.held_sales where true; end if;
  if to_regclass('public.expenses') is not null then delete from public.expenses where true; end if;
  if to_regclass('public.stock_receives') is not null then delete from public.stock_receives where true; end if;
  if to_regclass('public.activity_logs') is not null then delete from public.activity_logs where true; end if;
  if to_regclass('public.notifications') is not null then delete from public.notifications where true; end if;
  if to_regclass('public.products') is not null then delete from public.products where true; end if;

  -- Clear rows in any additional public table that references profiles, while
  -- explicitly excluding profiles itself. This avoids stale cashier references.
  for child in
    select distinct ns.nspname as schema_name, tbl.relname as table_name
    from pg_constraint con
    join pg_class tbl on tbl.oid = con.conrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.conrelid <> 'public.profiles'::regclass
      and ns.nspname = 'public'
      and tbl.relname not in (
        'credit_payments','credits','sale_items','sales','held_sales',
        'expenses','stock_receives','activity_logs','notifications','products'
      )
  loop
    execute format('delete from %I.%I where true', child.schema_name, child.table_name);
  end loop;

  -- Null FKs that still point at non-admin profiles, then remove other staff.
  -- (Sales/expenses/etc. were already deleted above; this covers any leftover refs.)
  update public.sales set cashier_id = null where cashier_id is distinct from admin_row.id;
  update public.held_sales set cashier_id = null where cashier_id is distinct from admin_row.id;
  update public.expenses set created_by = null where created_by is distinct from admin_row.id;
  update public.stock_receives set received_by = null where received_by is distinct from admin_row.id;
  update public.activity_logs set user_id = null where user_id is distinct from admin_row.id;
  update public.credit_payments set recorded_by = null where recorded_by is distinct from admin_row.id;

  delete from public.profiles where id <> admin_row.id;
  update public.profiles set is_active = true where id = admin_row.id;

  insert into public.app_settings
    (id, pub_name, logo_url, login_bg_url, till_number, receipt_footer, currency, factory_reset_at)
  values
    (1, 'Carwash Bar & Restaurant', null, null, 'TILL-001', '', 'KES', reset_time)
  on conflict (id) do update set
    pub_name = excluded.pub_name,
    logo_url = null,
    login_bg_url = null,
    till_number = 'TILL-001',
    receipt_footer = '',
    currency = 'KES',
    factory_reset_at = reset_time;

  return json_build_object(
    'ok', true,
    'message', 'Factory reset completed. The confirming administrator account and PIN were retained.',
    'admin_id', admin_row.id,
    'products_deleted', products_deleted,
    'sales_deleted', sales_deleted,
    'factory_reset_at', reset_time
  );
exception when others then
  return json_build_object('ok', false, 'error', sqlerrm, 'sqlstate', sqlstate);
end;
$$;

revoke all on function public.factory_reset_cloud(text, uuid) from public;
grant execute on function public.factory_reset_cloud(text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
