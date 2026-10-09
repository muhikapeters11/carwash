-- =============================================================================
-- BAR POS — FULL SUPABASE SCHEMA (single run)
-- Run this entire script once in: Supabase → SQL Editor → New query → Run
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS / exception handlers
-- =============================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- Products (catalog + stock levels)
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
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Sales (completed / held history for reports & dashboard)
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

-- Stock receives (purchase / delivery into inventory)
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

-- Stock audits (physical count adjustments)
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

-- Product returns (customer returns → stock up)
create table if not exists product_returns (
  id text primary key,
  product_id text,
  product_name text,
  quantity integer,
  amount integer,
  note text,
  cashier_id text,
  cashier_name text,
  created_at timestamptz
);

-- Credit events (open credit + payments; payload JSON)
create table if not exists credit_events (
  id text primary key default gen_random_uuid()::text,
  payload jsonb not null,
  created_at timestamptz default now()
);

-- Expenses
create table if not exists expenses (
  id text primary key,
  description text,
  amount integer,
  category text,
  recorded_by text,
  recorded_by_name text,
  created_at timestamptz
);

-- Suppliers
create table if not exists suppliers (
  id text primary key,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
);

-- Users (shared logins / PINs across all devices)
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

-- App settings (single row id = 'app')
create table if not exists app_settings (
  id text primary key,
  payload jsonb,
  updated_at timestamptz
);

-- ---------------------------------------------------------------------------
-- OPTIONAL COLUMNS (for older projects that already had tables)
-- ---------------------------------------------------------------------------
alter table products add column if not exists units_per_pack integer default 1;
alter table products add column if not exists pack_label text;
alter table products add column if not exists min_stock integer default 0;
alter table products add column if not exists image_url text;
alter table products add column if not exists is_active boolean default true;
alter table products add column if not exists updated_at timestamptz default now();
alter table products add column if not exists created_at timestamptz default now();

alter table sales add column if not exists sale_number text;
alter table sales add column if not exists amount_paid integer default 0;
alter table sales add column if not exists change_given integer default 0;
alter table sales add column if not exists credit_customer_name text;
alter table sales add column if not exists credit_id text;
alter table sales add column if not exists is_credit_payment boolean default false;
alter table sales add column if not exists device_id text;
alter table sales add column if not exists status text default 'completed';

alter table users add column if not exists username text;
alter table users add column if not exists allowed_tabs jsonb default '[]';
alter table users add column if not exists is_active boolean default true;
alter table users add column if not exists updated_at timestamptz;
alter table users add column if not exists created_at timestamptz;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY (open policies for private bar POS + anon key)
-- For a single business with trusted staff devices this is intentional.
-- Do NOT expose the service_role key in the web app.
-- ---------------------------------------------------------------------------

alter table products enable row level security;
alter table sales enable row level security;
alter table stock_receives enable row level security;
alter table stock_audits enable row level security;
alter table product_returns enable row level security;
alter table credit_events enable row level security;
alter table expenses enable row level security;
alter table suppliers enable row level security;
alter table users enable row level security;
alter table app_settings enable row level security;

drop policy if exists "anon all products" on products;
create policy "anon all products" on products for all using (true) with check (true);

drop policy if exists "anon all sales" on sales;
create policy "anon all sales" on sales for all using (true) with check (true);

drop policy if exists "anon all stock_receives" on stock_receives;
create policy "anon all stock_receives" on stock_receives for all using (true) with check (true);

drop policy if exists "anon all stock_audits" on stock_audits;
create policy "anon all stock_audits" on stock_audits for all using (true) with check (true);

drop policy if exists "anon all product_returns" on product_returns;
create policy "anon all product_returns" on product_returns for all using (true) with check (true);

drop policy if exists "anon all credit_events" on credit_events;
create policy "anon all credit_events" on credit_events for all using (true) with check (true);

drop policy if exists "anon all expenses" on expenses;
create policy "anon all expenses" on expenses for all using (true) with check (true);

drop policy if exists "anon all suppliers" on suppliers;
create policy "anon all suppliers" on suppliers for all using (true) with check (true);

drop policy if exists "anon all users" on users;
create policy "anon all users" on users for all using (true) with check (true);

drop policy if exists "anon all app_settings" on app_settings;
create policy "anon all app_settings" on app_settings for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- REALTIME (mandatory for multi-device live updates)
-- Adds each table to supabase_realtime publication (idempotent)
-- ---------------------------------------------------------------------------

do $$ begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sales; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table users; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table expenses; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table suppliers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table stock_receives; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table stock_audits; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table product_returns; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table app_settings; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table credit_events; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Tables in Realtime publication:
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- All POS tables present:
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'products','sales','users','expenses','suppliers',
    'stock_receives','stock_audits','product_returns',
    'app_settings','credit_events'
  )
order by table_name;
