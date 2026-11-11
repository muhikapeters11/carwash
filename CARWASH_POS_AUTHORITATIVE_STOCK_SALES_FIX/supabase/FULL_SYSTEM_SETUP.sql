-- =============================================================================
-- CARWASH / PUB POS — FULL SYSTEM SETUP (single paste)
-- Project: tvjdblbxmlteszcigckj
-- Paste this ENTIRE file into Supabase → SQL Editor → Run once on a new project.
-- Safe-ish to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
--
-- Default logins after seed (from schema):
--   Admin   PIN 233456
--   Cashier PIN 222222
--
-- FIX: complete_sale uses jsonb (not json) so || concatenation works
--      (avoids: operator does not exist: json || json)
-- =============================================================================

-- ============================================================
-- Pub POS — FULL schema
-- Paste entire file into Supabase → SQL Editor → Run
-- Users created by this file:
--   Admin   pmuhika7@gmail.com   / PIN 233456  / name muhika
--   Cashier pmuhika23@gmail.com  / PIN 222222
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  email text,
  full_name text not null,
  pin_hash text not null,
  role text not null check (role in ('admin', 'cashier')) default 'cashier',
  permissions text[] default array['dashboard','sell'],
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  sku text unique not null,
  name text not null,
  category text not null check (category in ('beer', 'spirits', 'soft_drinks')),
  price numeric(12,2) not null default 0,
  cost numeric(12,2) not null default 0,
  stock numeric(12,2) not null default 0,
  low_stock_threshold numeric(12,2) default 10,
  image_url text,
  is_barrel boolean default false,
  barrel_cups integer default 100,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.sales (
  id uuid primary key default uuid_generate_v4(),
  receipt_no text unique not null,
  total numeric(12,2) not null,
  cost_total numeric(12,2) not null default 0,
  payment_method text not null check (payment_method in ('cash', 'credit', 'credit_collection')),
  creditor_name text,
  cashier_id uuid references public.profiles(id),
  cashier_name text,
  is_credit_collection boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.sale_items (
  id uuid primary key default uuid_generate_v4(),
  sale_id uuid references public.sales(id) on delete cascade,
  product_id uuid,
  product_name text,
  quantity numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0
);

create table if not exists public.held_sales (
  id uuid primary key default uuid_generate_v4(),
  customer_name text not null,
  items jsonb not null,
  cashier_id uuid references public.profiles(id),
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create table if not exists public.credits (
  id uuid primary key default uuid_generate_v4(),
  customer_name text not null,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) default 0,
  remaining numeric(12,2) generated always as (amount - paid_amount) stored,
  sale_id uuid references public.sales(id),
  created_at timestamptz default now()
);

create table if not exists public.credit_payments (
  id uuid primary key default uuid_generate_v4(),
  credit_id uuid references public.credits(id) on delete cascade,
  amount numeric(12,2) not null,
  recorded_by uuid references public.profiles(id),
  paid_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default uuid_generate_v4(),
  description text not null,
  amount numeric(12,2) not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.stock_receives (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.products(id),
  product_name text,
  quantity numeric(12,2) not null,
  unit_cost numeric(12,2) not null,
  total_cost numeric(12,2) not null,
  receipt_no text,
  supplier text,
  received_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  user_name text,
  action text not null,
  details text,
  created_at timestamptz default now()
);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  message text not null,
  type text,
  is_read boolean default false,
  related_id text,
  created_at timestamptz default now()
);

create table if not exists public.app_settings (
  id integer primary key default 1 check (id = 1),
  pub_name text default 'My Pub',
  logo_url text,
  till_number text default 'TILL-001',
  receipt_footer text default '',
  currency text default 'KES',
  login_bg_url text,
  factory_reset_at timestamptz
);

insert into public.app_settings (id, pub_name, currency)
values (1, 'My Pub', 'KES')
on conflict (id) do nothing;

create index if not exists idx_products_sku on products(sku);
create index if not exists idx_sales_created on sales(created_at);
create index if not exists idx_profiles_active on profiles(is_active);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_updated on products;
create trigger products_updated before update on products
for each row execute function update_updated_at();

-- ---------- Login by PIN (bcrypt) ----------
create or replace function public.login_with_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public
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

create or replace function public.set_profile_pin(p_id uuid, p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(p_pin) <> 6 then
    return json_build_object('ok', false, 'error', 'PIN must be 6 digits');
  end if;
  update public.profiles
  set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_id;
  return json_build_object('ok', true);
end;
$$;

-- ---------- Atomic sale + stock lock ----------
create or replace function public.complete_sale(
  p_cashier_id uuid,
  p_cashier_name text,
  p_method text,
  p_creditor_name text,
  p_discount_percent numeric,
  p_items jsonb,
  p_client_sale_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  pid uuid;
  qty numeric;
  prod public.products%rowtype;
  subtotal numeric := 0;
  cost_total numeric := 0;
  discount numeric := 0;
  total numeric := 0;
  sale_id uuid := coalesce(p_client_sale_id, uuid_generate_v4());
  existing_sale public.sales%rowtype;
  receipt text := 'R' || to_char(now(), 'YYMMDDHH24MISS') || substr(replace(sale_id::text, '-', ''), 1, 4);
  stock_updates json := '[]'::json;
  line_items json := '[]'::json;
begin
  -- Idempotency: retries with the same local sale UUID return the first result
  -- instead of charging stock or creating a second receipt again.
  if p_client_sale_id is not null then
    select * into existing_sale from public.sales where id = p_client_sale_id;
    if found then
      return json_build_object(
        'ok', true,
        'stock_updates', '[]'::json,
        'sale', json_build_object(
          'id', existing_sale.id,
          'receipt_no', existing_sale.receipt_no,
          'total', existing_sale.total,
          'cost_total', existing_sale.cost_total,
          'payment_method', existing_sale.payment_method,
          'creditor_name', existing_sale.creditor_name,
          'cashier_id', existing_sale.cashier_id,
          'cashier_name', existing_sale.cashier_name,
          'created_at', existing_sale.created_at,
          'is_credit_collection', existing_sale.is_credit_collection,
          'items', coalesce((
            select json_agg(json_build_object(
              'product_id', si.product_id,
              'name', si.product_name,
              'qty', si.quantity,
              'price', si.unit_price,
              'cost', si.unit_cost
            ) order by si.id)
            from public.sale_items si where si.sale_id = existing_sale.id
          ), '[]'::json)
        )
      );
    end if;
  end if;

  if p_method not in ('cash', 'credit') then
    return json_build_object('ok', false, 'error', 'Invalid method');
  end if;
  if p_method = 'credit' and (p_creditor_name is null or length(trim(p_creditor_name)) = 0) then
    return json_build_object('ok', false, 'error', 'Creditor name required');
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    if qty is null or qty <= 0 then
      return json_build_object('ok', false, 'error', 'Invalid quantity');
    end if;

    select * into prod from public.products where id = pid for update;
    if not found or prod.is_active is false then
      return json_build_object('ok', false, 'error', 'Product unavailable');
    end if;
    if prod.stock < qty then
      return json_build_object('ok', false, 'error', prod.name || ': insufficient stock');
    end if;

    subtotal := subtotal + prod.price * qty;
    cost_total := cost_total + prod.cost * qty;
  end loop;

  if coalesce(p_discount_percent, 0) > 0 then
    discount := round(subtotal * least(100, p_discount_percent) / 100.0, 2);
  end if;
  total := greatest(0, round(subtotal - discount, 2));

  -- Insert parent sale FIRST so sale_items FK succeeds
  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    sale_id, receipt, total, cost_total, p_method, nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    update public.products
      set stock = stock - qty, updated_at = now()
      where id = pid
      returning * into prod;

    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (sale_id, prod.id, prod.name, qty, prod.price, prod.cost);

    stock_updates := stock_updates || json_build_array(json_build_object('id', prod.id, 'stock', prod.stock));
    line_items := line_items || json_build_array(json_build_object(
      'product_id', prod.id,
      'name', prod.name,
      'qty', qty,
      'price', prod.price,
      'cost', prod.cost
    ));
  end loop;

  if discount > 0 then
    line_items := line_items || json_build_array(json_build_object(
      'product_id', '_discount', 'name', 'Discount', 'qty', 1, 'price', -discount, 'cost', 0
    ));
  end if;

  if p_method = 'credit' then
    insert into public.credits (customer_name, amount, paid_amount, sale_id)
    values (trim(p_creditor_name), total, 0, sale_id);
  end if;

  return json_build_object(
    'ok', true,
    'stock_updates', stock_updates,
    'sale', json_build_object(
      'id', sale_id,
      'receipt_no', receipt,
      'total', total,
      'cost_total', cost_total,
      'payment_method', p_method,
      'creditor_name', nullif(trim(coalesce(p_creditor_name, '')), ''),
      'cashier_id', p_cashier_id,
      'cashier_name', p_cashier_name,
      'created_at', now(),
      'items', line_items,
      'is_credit_collection', false
    )
  );
end;
$$;

create or replace function public.record_credit_payment(
  p_credit_id uuid,
  p_amount numeric,
  p_by uuid,
  p_by_name text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.credits%rowtype;
  paid numeric;
  sale_id uuid := uuid_generate_v4();
begin
  select * into c from public.credits where id = p_credit_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Credit not found');
  end if;
  if c.remaining <= 0 then
    return json_build_object('ok', false, 'error', 'Already paid');
  end if;
  if p_amount is null or p_amount <= 0 then
    return json_build_object('ok', false, 'error', 'Invalid amount');
  end if;
  paid := least(c.remaining, round(p_amount, 2));
  update public.credits set paid_amount = paid_amount + paid where id = p_credit_id;
  insert into public.credit_payments (credit_id, amount, recorded_by)
  values (p_credit_id, paid, p_by);
  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection
  ) values (
    sale_id, 'CR' || to_char(now(), 'HH24MISSMS'), paid, 0, 'credit_collection',
    c.customer_name, p_by, p_by_name, true
  );
  return json_build_object('ok', true, 'paid', paid);
end;
$$;

-- Allow web app (anon key) to call RPCs
grant execute on function public.login_with_pin(text) to anon, authenticated, service_role;
drop function if exists public.complete_sale(uuid, text, text, text, numeric, jsonb);
grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) to anon, authenticated, service_role;
grant execute on function public.record_credit_payment(uuid, numeric, uuid, text) to anon, authenticated, service_role;
grant execute on function public.set_profile_pin(uuid, text) to authenticated, service_role;

-- ---------- Users (safe upsert — never DELETE profiles referenced by sales) ----------
-- Admin:   pmuhika7@gmail.com  / 233456
-- Cashier: pmuhika23@gmail.com / 222222
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
      'pmuhika7@gmail.com', 'muhika', crypt('233456', gen_salt('bf')), 'admin',
      array['dashboard','sell','receive','products','inventory','credit','expenses','reports','users','activity','settings'],
      true
    );
  else
    update public.profiles
    set full_name = 'muhika',
        pin_hash = crypt('233456', gen_salt('bf')),
        role = 'admin',
        permissions = array['dashboard','sell','receive','products','inventory','credit','expenses','reports','users','activity','settings'],
        is_active = true
    where id = v_admin;
  end if;

  select id into v_cashier
  from public.profiles
  where lower(email) = lower('pmuhika23@gmail.com')
  order by created_at asc nulls last
  limit 1;

  if v_cashier is null then
    insert into public.profiles (email, full_name, pin_hash, role, permissions, is_active)
    values (
      'pmuhika23@gmail.com', 'Cashier', crypt('222222', gen_salt('bf')), 'cashier',
      array['dashboard','sell','inventory','credit','expenses','receive'],
      true
    );
  else
    update public.profiles
    set full_name = 'Cashier',
        pin_hash = crypt('222222', gen_salt('bf')),
        role = 'cashier',
        permissions = array['dashboard','sell','inventory','credit','expenses','receive'],
        is_active = true
    where id = v_cashier;
  end if;
end $$;
-- =============================================================================
-- Pub POS — Critical fix: complete_sale FK order + hard product delete helper
-- Run this in Supabase SQL Editor (once) against the project used by the app.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Fixed complete_sale: insert sales row FIRST, then sale_items (FK safe)
--    Previous order inserted sale_items before sales, violating the FK and
--    causing every cloud sale (and stock deduct / credit create) to fail.
-- ---------------------------------------------------------------------------
create or replace function public.complete_sale(
  p_cashier_id uuid,
  p_cashier_name text,
  p_method text,
  p_creditor_name text,
  p_discount_percent numeric,
  p_items jsonb,
  p_client_sale_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  item jsonb;
  pid uuid;
  qty numeric;
  prod public.products%rowtype;
  subtotal numeric := 0;
  cost_total numeric := 0;
  discount numeric := 0;
  total numeric := 0;
  sale_id uuid := coalesce(p_client_sale_id, uuid_generate_v4());
  existing_sale public.sales%rowtype;
  receipt text := 'R' || to_char(now(), 'YYMMDDHH24MISS') || substr(replace(sale_id::text, '-', ''), 1, 4);
  stock_updates json := '[]'::json;
  line_items json := '[]'::json;
begin
  -- Idempotency: retries with the same local sale UUID return the first result
  if p_client_sale_id is not null then
    select * into existing_sale from public.sales where id = p_client_sale_id;
    if found then
      return json_build_object(
        'ok', true,
        'stock_updates', '[]'::json,
        'sale', json_build_object(
          'id', existing_sale.id,
          'receipt_no', existing_sale.receipt_no,
          'total', existing_sale.total,
          'cost_total', existing_sale.cost_total,
          'payment_method', existing_sale.payment_method,
          'creditor_name', existing_sale.creditor_name,
          'cashier_id', existing_sale.cashier_id,
          'cashier_name', existing_sale.cashier_name,
          'created_at', existing_sale.created_at,
          'is_credit_collection', existing_sale.is_credit_collection,
          'items', coalesce((
            select json_agg(json_build_object(
              'product_id', si.product_id,
              'name', si.product_name,
              'qty', si.quantity,
              'price', si.unit_price,
              'cost', si.unit_cost
            ) order by si.id)
            from public.sale_items si where si.sale_id = existing_sale.id
          ), '[]'::json)
        )
      );
    end if;
  end if;

  if p_method not in ('cash', 'credit') then
    return json_build_object('ok', false, 'error', 'Invalid method');
  end if;
  if p_method = 'credit' and (p_creditor_name is null or length(trim(p_creditor_name)) = 0) then
    return json_build_object('ok', false, 'error', 'Creditor name required');
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  -- Validate + lock stock first (no writes yet)
  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    if qty is null or qty <= 0 then
      return json_build_object('ok', false, 'error', 'Invalid quantity');
    end if;

    select * into prod from public.products where id = pid for update;
    if not found or prod.is_active is false then
      return json_build_object('ok', false, 'error', 'Product unavailable');
    end if;
    if prod.stock < qty then
      return json_build_object('ok', false, 'error', prod.name || ': insufficient stock');
    end if;

    subtotal := subtotal + prod.price * qty;
    cost_total := cost_total + prod.cost * qty;
  end loop;

  if coalesce(p_discount_percent, 0) > 0 then
    discount := round(subtotal * least(100, p_discount_percent) / 100.0, 2);
  end if;
  total := greatest(0, round(subtotal - discount, 2));

  -- Insert parent sale FIRST so sale_items FK succeeds
  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    sale_id, receipt, total, cost_total, p_method, nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

  -- Deduct stock + write sale_items
  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    update public.products
      set stock = stock - qty, updated_at = now()
      where id = pid
      returning * into prod;

    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (sale_id, prod.id, prod.name, qty, prod.price, prod.cost);

    stock_updates := stock_updates || json_build_array(json_build_object('id', prod.id, 'stock', prod.stock));
    line_items := line_items || json_build_array(json_build_object(
      'product_id', prod.id,
      'name', prod.name,
      'qty', qty,
      'price', prod.price,
      'cost', prod.cost
    ));
  end loop;

  if discount > 0 then
    line_items := line_items || json_build_array(json_build_object(
      'product_id', '_discount', 'name', 'Discount', 'qty', 1, 'price', -discount, 'cost', 0
    ));
  end if;

  if p_method = 'credit' then
    insert into public.credits (customer_name, amount, paid_amount, sale_id)
    values (trim(p_creditor_name), total, 0, sale_id);
  end if;

  return json_build_object(
    'ok', true,
    'stock_updates', stock_updates,
    'sale', json_build_object(
      'id', sale_id,
      'receipt_no', receipt,
      'total', total,
      'cost_total', cost_total,
      'payment_method', p_method,
      'creditor_name', nullif(trim(coalesce(p_creditor_name, '')), ''),
      'cashier_id', p_cashier_id,
      'cashier_name', p_cashier_name,
      'created_at', now(),
      'is_credit_collection', false,
      'items', line_items
    )
  );
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
end;
$$;

grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Hard-delete product helper (used by app instead of soft-delete only)
-- ---------------------------------------------------------------------------
create or replace function public.hard_delete_product(p_product_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_product_id is null then
    return json_build_object('ok', false, 'error', 'Missing product id');
  end if;
  -- Detach historical rows so the product row can be removed permanently.
  -- Prefer NULL; if the column is NOT NULL, delete the dependent rows instead.
  begin
    update public.stock_receives set product_id = null where product_id = p_product_id;
  exception when not_null_violation then
    delete from public.stock_receives where product_id = p_product_id;
  end;
  begin
    update public.sale_items set product_id = null where product_id = p_product_id;
  exception when not_null_violation then
    null; -- keep sale line names; leave product_id as-is if we cannot null it
  end;
  delete from public.products where id = p_product_id;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.hard_delete_product(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Ensure RLS is open for POS tables (idempotent safety net)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','products','sales','sale_items','held_sales','credits','credit_payments',
    'expenses','stock_receives','activity_logs','notifications','app_settings'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists pos_all_%I on public.%I', t, t);
      execute format('create policy pos_all_%I on public.%I for all using (true) with check (true)', t, t);
      execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
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
-- Pub POS: clear product catalogue and report history without deleting staff.
-- Run once in Supabase SQL Editor for the project used by this desktop app.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Shared product photo bucket. The app uses the public anon client, so this
-- bucket is public-read and allows image uploads by the existing client flow.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select using (bucket_id = 'product-images');
drop policy if exists product_images_anon_insert on storage.objects;
create policy product_images_anon_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'product-images');
drop policy if exists product_images_anon_update on storage.objects;
create policy product_images_anon_update on storage.objects
  for update to anon, authenticated using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

-- Ensure live Realtime events are enabled for the POS tables (idempotent).
do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['products','sales','sale_items','stock_receives','expenses',
      'credits','app_settings','profiles','activity_logs','held_sales'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.clear_products_and_reports(p_pin text, p_admin_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  admin_row public.profiles%rowtype;
  reset_time timestamptz := clock_timestamp();
  products_deleted bigint := 0;
  sales_deleted bigint := 0;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or p_admin_id is null then
    return json_build_object('ok', false, 'error', 'Enter the six-digit administrator PIN.');
  end if;

  select p.* into admin_row
  from public.profiles p
  where p.id = p_admin_id and p.role = 'admin' and p.is_active is true
    and p.pin_hash = crypt(p_pin, p.pin_hash)
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Administrator PIN is incorrect or account is inactive.');
  end if;

  select count(*) into products_deleted from public.products;
  select count(*) into sales_deleted from public.sales;

  -- WHERE true satisfies safe-update / "DELETE requires a WHERE clause" guards.
  delete from public.credit_payments where true;
  delete from public.credits where true;
  delete from public.sale_items where true;
  delete from public.sales where true;
  delete from public.held_sales where true;
  delete from public.stock_receives where true;
  delete from public.expenses where true;
  delete from public.activity_logs where true;
  delete from public.notifications where true;
  delete from public.products where true;

  -- The marker makes every connected till discard stale local copies before
  -- pulling the now-empty catalogue and reports.
  update public.app_settings set factory_reset_at = reset_time where id = 1;

  return json_build_object('ok', true, 'products_deleted', products_deleted,
    'sales_deleted', sales_deleted, 'factory_reset_at', reset_time);
exception when others then
  return json_build_object('ok', false, 'error', sqlerrm, 'sqlstate', sqlstate);
end;
$$;

revoke all on function public.clear_products_and_reports(text, uuid) from public;
grant execute on function public.clear_products_and_reports(text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
-- Fast POS checkout: add client-generated sale IDs for safe background retries.
-- Run once in Supabase SQL Editor. Existing sales are not changed.
drop function if exists public.complete_sale(uuid, text, text, text, numeric, jsonb);
create or replace function public.complete_sale(
  p_cashier_id uuid,
  p_cashier_name text,
  p_method text,
  p_creditor_name text,
  p_discount_percent numeric,
  p_items jsonb,
  p_client_sale_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  pid uuid;
  qty numeric;
  prod public.products%rowtype;
  subtotal numeric := 0;
  cost_total numeric := 0;
  discount numeric := 0;
  total numeric := 0;
  sale_id uuid := coalesce(p_client_sale_id, uuid_generate_v4());
  existing_sale public.sales%rowtype;
  receipt text := 'R' || to_char(now(), 'YYMMDDHH24MISS') || substr(replace(sale_id::text, '-', ''), 1, 4);
  stock_updates json := '[]'::json;
  line_items json := '[]'::json;
begin
  -- Idempotency: retries with the same local sale UUID return the first result
  -- instead of charging stock or creating a second receipt again.
  if p_client_sale_id is not null then
    select * into existing_sale from public.sales where id = p_client_sale_id;
    if found then
      return json_build_object(
        'ok', true,
        'stock_updates', '[]'::json,
        'sale', json_build_object(
          'id', existing_sale.id,
          'receipt_no', existing_sale.receipt_no,
          'total', existing_sale.total,
          'cost_total', existing_sale.cost_total,
          'payment_method', existing_sale.payment_method,
          'creditor_name', existing_sale.creditor_name,
          'cashier_id', existing_sale.cashier_id,
          'cashier_name', existing_sale.cashier_name,
          'created_at', existing_sale.created_at,
          'is_credit_collection', existing_sale.is_credit_collection,
          'items', coalesce((
            select json_agg(json_build_object(
              'product_id', si.product_id,
              'name', si.product_name,
              'qty', si.quantity,
              'price', si.unit_price,
              'cost', si.unit_cost
            ) order by si.id)
            from public.sale_items si where si.sale_id = existing_sale.id
          ), '[]'::json)
        )
      );
    end if;
  end if;

  if p_method not in ('cash', 'credit') then
    return json_build_object('ok', false, 'error', 'Invalid method');
  end if;
  if p_method = 'credit' and (p_creditor_name is null or length(trim(p_creditor_name)) = 0) then
    return json_build_object('ok', false, 'error', 'Creditor name required');
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    if qty is null or qty <= 0 then
      return json_build_object('ok', false, 'error', 'Invalid quantity');
    end if;

    select * into prod from public.products where id = pid for update;
    if not found or prod.is_active is false then
      return json_build_object('ok', false, 'error', 'Product unavailable');
    end if;
    if prod.stock < qty then
      return json_build_object('ok', false, 'error', prod.name || ': insufficient stock');
    end if;

    subtotal := subtotal + prod.price * qty;
    cost_total := cost_total + prod.cost * qty;
  end loop;

  if coalesce(p_discount_percent, 0) > 0 then
    discount := round(subtotal * least(100, p_discount_percent) / 100.0, 2);
  end if;
  total := greatest(0, round(subtotal - discount, 2));

  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    update public.products
      set stock = stock - qty
      where id = pid
      returning * into prod;

    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (sale_id, prod.id, prod.name, qty, prod.price, prod.cost);

    stock_updates := stock_updates || json_build_array(json_build_object('id', prod.id, 'stock', prod.stock));
    line_items := line_items || json_build_array(json_build_object(
      'product_id', prod.id,
      'name', prod.name,
      'qty', qty,
      'price', prod.price,
      'cost', prod.cost
    ));
  end loop;

  if discount > 0 then
    line_items := line_items || json_build_array(json_build_object(
      'product_id', '_discount', 'name', 'Discount', 'qty', 1, 'price', -discount, 'cost', 0
    ));
  end if;

  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    sale_id, receipt, total, cost_total, p_method, nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

  if p_method = 'credit' then
    insert into public.credits (customer_name, amount, paid_amount, sale_id)
    values (trim(p_creditor_name), total, 0, sale_id);
  end if;

  return json_build_object(
    'ok', true,
    'stock_updates', stock_updates,
    'sale', json_build_object(
      'id', sale_id,
      'receipt_no', receipt,
      'total', total,
      'cost_total', cost_total,
      'payment_method', p_method,
      'creditor_name', nullif(trim(coalesce(p_creditor_name, '')), ''),
      'cashier_id', p_cashier_id,
      'cashier_name', p_cashier_name,
      'created_at', now(),
      'items', line_items,
      'is_credit_collection', false
    )
  );
end;
$$;

grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) to anon, authenticated, service_role;
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

notify pgrst, 'reload schema';


-- =============================================================================
-- Multi-device columns + realtime
-- =============================================================================
-- Multi-device POS sync: run once in Supabase SQL Editor.
-- Enables Realtime change events for every shared business-data table.
-- This does not change existing table data or disable existing RLS policies.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text DEFAULT 'misc';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS barrels numeric(12,2);
ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS received_by_name text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS business_day_hour integer DEFAULT 9;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS receipt_show_cost boolean DEFAULT false;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'products', 'sales', 'sale_items', 'stock_receives', 'expenses',
    'credits', 'credit_payments', 'app_settings', 'profiles',
    'held_sales', 'activity_logs', 'notifications'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN
          RAISE NOTICE 'Realtime publication unavailable while adding %', tbl;
      END;
    END IF;
  END LOOP;
END $$;

-- Make sure the API schema cache sees any recently-created database objects.
NOTIFY pgrst, 'reload schema';


-- Idempotent credit collection RPC. The client-generated UUID is reused for
-- both the payment row and collection sale, so retries cannot double-charge.
CREATE OR REPLACE FUNCTION public.record_credit_payment_once(
  p_credit_id uuid,
  p_amount numeric,
  p_by uuid,
  p_by_name text,
  p_client_payment_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.credits%rowtype;
  paid numeric;
BEGIN
  IF p_client_payment_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Payment id required');
  END IF;

  -- A prior successful attempt means this retry is already complete.
  SELECT amount INTO paid
  FROM public.credit_payments
  WHERE id = p_client_payment_id;
  IF FOUND THEN
    RETURN json_build_object('ok', true, 'paid', paid, 'duplicate', true);
  END IF;

  SELECT * INTO c FROM public.credits WHERE id = p_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Credit not found');
  END IF;
  IF c.remaining <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Already paid');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Invalid amount');
  END IF;

  paid := LEAST(c.remaining, ROUND(p_amount, 2));
  UPDATE public.credits SET paid_amount = paid_amount + paid WHERE id = p_credit_id;
  INSERT INTO public.credit_payments (id, credit_id, amount, recorded_by)
  VALUES (p_client_payment_id, p_credit_id, paid, p_by);
  INSERT INTO public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection
  ) VALUES (
    p_client_payment_id,
    'CR' || RIGHT(REPLACE(p_client_payment_id::text, '-', ''), 8),
    paid, 0, 'credit_collection', c.customer_name, p_by, p_by_name, true
  ) ON CONFLICT (id) DO NOTHING;

  RETURN json_build_object('ok', true, 'paid', paid, 'duplicate', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_credit_payment_once(uuid, numeric, uuid, text, uuid)
  TO anon, authenticated, service_role;


-- =============================================================================
-- RLS + login_with_pin search_path fix
-- =============================================================================
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


-- =============================================================================
-- Cloud branding / realtime extras
-- =============================================================================
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


-- =============================================================================
-- Factory reset / login helpers
-- =============================================================================
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

  -- Null leftover FKs, then remove non-admin staff (sales already deleted above).
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


-- =============================================================================
-- AUTHORITATIVE complete_sale (jsonb — MUST be last)
-- =============================================================================
-- CARWASH BAR & RESTAURANT POS
-- AUTHORITATIVE ATOMIC SALE + STOCK DEDUCTION
-- Run this entire script in Supabase SQL Editor on the SAME project used by every POS device.
-- Safe to re-run. It does not delete or rewrite existing sales or products.
-- Required tables/columns are those defined in supabase/schema.sql.

create or replace function public.complete_sale(
  p_cashier_id uuid,
  p_cashier_name text,
  p_method text,
  p_creditor_name text,
  p_discount_percent numeric,
  p_items jsonb,
  p_client_sale_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id uuid;
  v_existing public.sales%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_receipt text;
  v_stock_updates jsonb := '[]'::jsonb;
  v_line_items jsonb := '[]'::jsonb;
begin
  -- Every app checkout supplies a stable UUID. It makes network retries safe.
  if p_client_sale_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing sale id. Please retry checkout.');
  end if;
  v_sale_id := p_client_sale_id;

  -- Serialize retries of the same sale id before checking for an existing sale.
  -- This prevents two simultaneous requests from deducting the same sale twice.
  perform pg_advisory_xact_lock(hashtextextended(v_sale_id::text, 0));

  select * into v_existing from public.sales where id = v_sale_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'stock', p.stock)), '[]'::jsonb)
      into v_stock_updates
      from public.sale_items si
      join public.products p on p.id = si.product_id
     where si.sale_id = v_existing.id;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'stock_updates', v_stock_updates,
      'sale', jsonb_build_object(
        'id', v_existing.id,
        'receipt_no', v_existing.receipt_no,
        'total', v_existing.total,
        'cost_total', v_existing.cost_total,
        'payment_method', v_existing.payment_method,
        'creditor_name', v_existing.creditor_name,
        'cashier_id', v_existing.cashier_id,
        'cashier_name', v_existing.cashier_name,
        'created_at', v_existing.created_at,
        'is_credit_collection', v_existing.is_credit_collection,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_id', si.product_id,
            'name', si.product_name,
            'qty', si.quantity,
            'price', si.unit_price,
            'cost', si.unit_cost
          ) order by si.id)
          from public.sale_items si where si.sale_id = v_existing.id
        ), '[]'::json)
      )
    );
  end if;

  if p_method is null or p_method not in ('cash', 'credit') then
    return jsonb_build_object('ok', false, 'error', 'Invalid payment method.');
  end if;
  if p_method = 'credit' and coalesce(length(trim(p_creditor_name)), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Creditor name is required.');
  end if;
  if coalesce(p_discount_percent, 0) < 0 or coalesce(p_discount_percent, 0) > 100 then
    return jsonb_build_object('ok', false, 'error', 'Discount must be between 0 and 100 percent.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Cart is empty.');
  end if;

  -- Validate and lock each distinct product in stable UUID order. Duplicate
  -- cart lines are combined so they cannot bypass the stock check.
  for v_item in
    select x.product_id, sum(x.qty)::numeric as qty
      from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric)
     group by x.product_id
     order by x.product_id
  loop
    if v_item.product_id is null or v_item.qty is null or v_item.qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Invalid product or quantity.');
    end if;

    select * into v_product
      from public.products
     where id = v_item.product_id
     for update;

    if not found or v_product.is_active is false then
      return jsonb_build_object('ok', false, 'error', 'A product is unavailable.');
    end if;
    if coalesce(v_product.stock, 0) < v_item.qty then
      return jsonb_build_object(
        'ok', false,
        'error', v_product.name || ': only ' || coalesce(v_product.stock, 0)::text || ' in stock.'
      );
    end if;

    v_subtotal := v_subtotal + v_product.price * v_item.qty;
    v_cost_total := v_cost_total + v_product.cost * v_item.qty;
  end loop;

  v_discount := round(v_subtotal * coalesce(p_discount_percent, 0) / 100.0, 2);
  v_total := greatest(0, round(v_subtotal - v_discount, 2));
  -- Deterministic from sale id so offline-printed receipts match the server receipt.
  v_receipt := 'R' || upper(substr(replace(v_sale_id::text, '-', ''), 1, 12));

  -- All following writes are part of this one PostgreSQL transaction.
  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    v_sale_id, v_receipt, v_total, v_cost_total, p_method,
    nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

  for v_item in
    select x.product_id, sum(x.qty)::numeric as qty
      from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric)
     group by x.product_id
     order by x.product_id
  loop
    update public.products
       set stock = stock - v_item.qty,
           updated_at = now()
     where id = v_item.product_id
     returning * into v_product;

    insert into public.sale_items (
      sale_id, product_id, product_name, quantity, unit_price, unit_cost
    ) values (
      v_sale_id, v_product.id, v_product.name, v_item.qty, v_product.price, v_product.cost
    );

    v_stock_updates := v_stock_updates || jsonb_build_array(
      jsonb_build_object('id', v_product.id, 'stock', v_product.stock)
    );
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'qty', v_item.qty,
      'price', v_product.price,
      'cost', v_product.cost
    ));
  end loop;

  if v_discount > 0 then
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'product_id', '_discount', 'name', 'Discount', 'qty', 1, 'price', -v_discount, 'cost', 0
    ));
  end if;

  if p_method = 'credit' then
    insert into public.credits (customer_name, amount, paid_amount, sale_id)
    values (trim(p_creditor_name), v_total, 0, v_sale_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'stock_updates', v_stock_updates,
    'sale', jsonb_build_object(
      'id', v_sale_id,
      'receipt_no', v_receipt,
      'total', v_total,
      'cost_total', v_cost_total,
      'payment_method', p_method,
      'creditor_name', nullif(trim(coalesce(p_creditor_name, '')), ''),
      'cashier_id', p_cashier_id,
      'cashier_name', p_cashier_name,
      'created_at', now(),
      'is_credit_collection', false,
      'items', v_line_items
    )
  );
end;
$$;

revoke all on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) from public;
grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid)
  to anon, authenticated, service_role;


-- Hard stop on negative stock (defence in depth; complete_sale already validates).
do $$
begin
  alter table public.products
    drop constraint if exists products_stock_non_negative;
  alter table public.products
    add constraint products_stock_non_negative check (stock >= 0);
exception
  when others then
    raise notice 'Could not add products_stock_non_negative: %', SQLERRM;
end $$;


-- ---------------------------------------------------------------------------
-- Product images: public Storage bucket so every device loads the same photo
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists product_images_anon_insert on storage.objects;
create policy product_images_anon_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'product-images');

drop policy if exists product_images_anon_update on storage.objects;
create policy product_images_anon_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

drop policy if exists product_images_anon_delete on storage.objects;
create policy product_images_anon_delete on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'product-images');

-- Stock changes must notify all connected POS clients.
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'supabase_realtime publication is not available; enable Realtime for public.products in Supabase Dashboard.';
end $$;

