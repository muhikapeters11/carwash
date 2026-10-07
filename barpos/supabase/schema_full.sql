-- ============================================================
-- BAR POS — FULL SUPABASE SCHEMA (latest)
-- Paste entire script into: Supabase → SQL Editor → Run
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- ============================================================

create extension if not exists "pgcrypto";

-- -------------------- PRODUCTS --------------------
create table if not exists products (
  id text primary key,
  sku text,
  name text not null,
  category text not null,
  price integer not null default 0,
  cost integer not null default 0,
  stock_quantity integer not null default 0,
  units_per_pack integer default 1,
  pack_label text,
  min_stock integer default 0,
  image_url text,
  is_active boolean default true,
  row_version integer not null default 1,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists products_updated_at_idx on products (updated_at desc);
create index if not exists products_category_idx on products (category);

-- -------------------- SALES --------------------
create table if not exists sales (
  id text primary key,
  sale_number text,
  items jsonb not null default '[]',
  subtotal integer default 0,
  total integer default 0,
  payment_method text,
  amount_paid integer default 0,
  change_given integer default 0,
  credit_customer_name text,
  credit_id text,
  cashier_id text,
  cashier_name text,
  status text default 'completed',
  is_credit_payment boolean default false,
  created_at timestamptz,
  device_id text
);

create index if not exists sales_created_at_idx on sales (created_at desc);
create index if not exists sales_cashier_idx on sales (cashier_id);

-- -------------------- PRODUCT RETURNS --------------------
create table if not exists product_returns (
  id text primary key,
  product_id text,
  product_name text,
  quantity integer not null default 0,
  amount integer not null default 0,
  note text,
  cashier_id text,
  cashier_name text,
  created_at timestamptz default now()
);

-- -------------------- STOCK RECEIVES --------------------
create table if not exists stock_receives (
  id text primary key,
  product_id text,
  product_name text,
  quantity integer,
  total_cost integer,
  unit_cost integer,
  supplier_name text,
  receipt_no text,
  received_by text,
  received_by_name text,
  created_at timestamptz,
  seen_by_admin boolean default false
);

create index if not exists stock_receives_created_at_idx on stock_receives (created_at desc);

-- -------------------- STOCK AUDITS --------------------
create table if not exists stock_audits (
  id text primary key,
  product_id text,
  product_name text,
  previous_qty integer,
  new_qty integer,
  difference integer,
  audited_by text,
  audited_by_name text,
  note text,
  created_at timestamptz,
  seen_by_admin boolean default false
);

-- -------------------- CREDIT EVENTS --------------------
create table if not exists credit_events (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now()
);

-- -------------------- EXPENSES --------------------
create table if not exists expenses (
  id text primary key,
  description text,
  amount integer,
  category text,
  recorded_by text,
  recorded_by_name text,
  created_at timestamptz
);

-- -------------------- SUPPLIERS --------------------
create table if not exists suppliers (
  id text primary key,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz
);

-- -------------------- USERS (shared PINs) --------------------
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

create index if not exists users_pin_idx on users (pin);

-- -------------------- APP SETTINGS (single row id = 'app') --------------------
create table if not exists app_settings (
  id text primary key,
  payload jsonb,
  updated_at timestamptz
);

-- -------------------- OPTIONAL: conflict log --------------------
create table if not exists sync_conflict_log (
  id bigserial primary key,
  table_name text not null,
  record_id text not null,
  detail jsonb,
  created_at timestamptz default now()
);

-- -------------------- ROW LEVEL SECURITY --------------------
alter table products enable row level security;
alter table product_returns enable row level security;
alter table sales enable row level security;
alter table stock_receives enable row level security;
alter table stock_audits enable row level security;
alter table credit_events enable row level security;
alter table expenses enable row level security;
alter table suppliers enable row level security;
alter table users enable row level security;
alter table app_settings enable row level security;
alter table sync_conflict_log enable row level security;

-- Open policies for easy multi-device setup (tighten before public internet exposure)
drop policy if exists "anon all products" on products;
drop policy if exists "anon all product_returns" on product_returns;
drop policy if exists "anon all sales" on sales;
drop policy if exists "anon all stock_receives" on stock_receives;
drop policy if exists "anon all stock_audits" on stock_audits;
drop policy if exists "anon all credit_events" on credit_events;
drop policy if exists "anon all expenses" on expenses;
drop policy if exists "anon all suppliers" on suppliers;
drop policy if exists "anon all users" on users;
drop policy if exists "anon all app_settings" on app_settings;
drop policy if exists "anon all sync_conflict_log" on sync_conflict_log;

create policy "anon all products" on products for all using (true) with check (true);
create policy "anon all product_returns" on product_returns for all using (true) with check (true);
create policy "anon all sales" on sales for all using (true) with check (true);
create policy "anon all stock_receives" on stock_receives for all using (true) with check (true);
create policy "anon all stock_audits" on stock_audits for all using (true) with check (true);
create policy "anon all credit_events" on credit_events for all using (true) with check (true);
create policy "anon all expenses" on expenses for all using (true) with check (true);
create policy "anon all suppliers" on suppliers for all using (true) with check (true);
create policy "anon all users" on users for all using (true) with check (true);
create policy "anon all app_settings" on app_settings for all using (true) with check (true);
create policy "anon all sync_conflict_log" on sync_conflict_log for all using (true) with check (true);

-- -------------------- TRIGGERS (product updated_at + version) --------------------
create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.row_version = coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row
  execute function public.set_product_updated_at();

-- Log large stock jumps (detection only)
create or replace function public.log_product_stock_jump()
returns trigger
language plpgsql
as $$
begin
  if old.stock_quantity is distinct from new.stock_quantity
     and abs(coalesce(new.stock_quantity, 0) - coalesce(old.stock_quantity, 0)) > 50 then
    insert into public.sync_conflict_log (table_name, record_id, detail)
    values (
      'products',
      new.id,
      jsonb_build_object(
        'old_stock', old.stock_quantity,
        'new_stock', new.stock_quantity,
        'name', new.name
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_log_stock_jump on public.products;
create trigger products_log_stock_jump
  after update on public.products
  for each row
  execute function public.log_product_stock_jump();

-- -------------------- REALTIME (live product updates) --------------------
-- Ignore error if already added
do $$
begin
  alter publication supabase_realtime add table products;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table sales;
exception when duplicate_object then
  null;
end $$;

-- ============================================================
-- DONE
-- Tables: products, sales, stock_receives, stock_audits,
--         credit_events, expenses, suppliers, users, app_settings
-- ============================================================
