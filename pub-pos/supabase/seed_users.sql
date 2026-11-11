-- Pub POS: repair the two cloud PIN accounts without deleting business data.
-- Run this in Supabase SQL Editor for project wrtmswnfgutlmkjzdzaj.
-- Safe to run more than once. It does NOT reset products, sales, stock, or expenses.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Make sure the profiles table exists. Run schema.sql first on a brand-new project.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist. Run supabase/schema.sql first, then rerun this repair.';
  end if;
end $$;

-- Keep the two requested accounts and set their bcrypt hashes on the database.
do $$
declare
  v_admin uuid;
  v_cashier uuid;
begin
  select id into v_admin
  from public.profiles
  where lower(email) = lower('pmuhika7@gmail.com')
  order by created_at asc nulls last
  limit 1;

  if v_admin is null then
    insert into public.profiles (email, full_name, pin_hash, role, permissions, is_active)
    values (
      'pmuhika7@gmail.com', 'Admin', crypt('233456', gen_salt('bf')), 'admin',
      array['dashboard','sell','receive','products','inventory','credit','expenses','reports','users','activity','settings'], true
    ) returning id into v_admin;
  else
    update public.profiles
    set email = 'pmuhika7@gmail.com', full_name = 'Admin',
        pin_hash = crypt('233456', gen_salt('bf')), role = 'admin',
        permissions = array['dashboard','sell','receive','products','inventory','credit','expenses','reports','users','activity','settings'],
        is_active = true
    where id = v_admin;
  end if;

  -- Deactivate duplicate rows for this email rather than deleting records that
  -- might be referenced by historical sales.
  update public.profiles set is_active = false
  where lower(email) = lower('pmuhika7@gmail.com') and id <> v_admin;

  select id into v_cashier
  from public.profiles
  where lower(email) = lower('pmuhika23@gmail.com')
  order by created_at asc nulls last
  limit 1;

  if v_cashier is null then
    insert into public.profiles (email, full_name, pin_hash, role, permissions, is_active)
    values (
      'pmuhika23@gmail.com', 'Cashier', crypt('222222', gen_salt('bf')), 'cashier',
      array['dashboard','sell','inventory','credit','expenses','receive'], true
    ) returning id into v_cashier;
  else
    update public.profiles
    set email = 'pmuhika23@gmail.com', full_name = 'Cashier',
        pin_hash = crypt('222222', gen_salt('bf')), role = 'cashier',
        permissions = array['dashboard','sell','inventory','credit','expenses','receive'],
        is_active = true
    where id = v_cashier;
  end if;

  update public.profiles set is_active = false
  where lower(email) = lower('pmuhika23@gmail.com') and id <> v_cashier;
end $$;

-- PIN-only login is the current app design: the email identifies the staff row,
-- while the unique six-digit PIN is entered on the login screen.
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
grant usage on schema public to anon, authenticated;
grant execute on function public.login_with_pin(text) to anon, authenticated, service_role;

-- The Users screen creates a cashier row and then calls this RPC to replace
-- the temporary client hash with a server-generated bcrypt hash.
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

-- The app also reads the staff list and updates profile fields. This is the
-- existing PIN-based client model; do not use a service_role key in the app.
alter table public.profiles enable row level security;
-- Do NOT grant clients SELECT on pin_hash. Grant only the columns the app reads.
revoke all on table public.profiles from anon, authenticated;
grant select (id, email, full_name, role, permissions, is_active, created_at)
  on public.profiles to anon, authenticated;
grant insert (email, full_name, pin_hash, role, permissions, is_active)
  on public.profiles to anon, authenticated;
grant update (full_name, permissions, is_active, pin_hash)
  on public.profiles to anon, authenticated;
grant delete on public.profiles to anon, authenticated;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'pub_pos_profiles_client_access'
  ) then
    create policy pub_pos_profiles_client_access on public.profiles
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';

-- After running, verify the profiles exist without displaying PIN hashes:
-- select email, role, is_active, pin_hash is not null as has_pin_hash
-- from public.profiles
-- where lower(email) in ('pmuhika7@gmail.com','pmuhika23@gmail.com')
-- order by role;
