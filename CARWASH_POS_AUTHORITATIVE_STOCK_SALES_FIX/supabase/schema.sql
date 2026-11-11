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
-- WARNING: Prefer supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql after any schema bootstrap.
-- The function below is a bootstrap default and may lag the authoritative version.

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
