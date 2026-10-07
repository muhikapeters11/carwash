-- ============================================================
-- Optional: conflict detection helpers on Supabase
-- Run in SQL Editor AFTER schema.sql
-- ============================================================

-- 1) Auto-bump updated_at on products (supports LWW on clients)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at();

-- 2) Optional row version for optimistic concurrency (advanced)
alter table public.products
  add column if not exists row_version integer not null default 1;

create or replace function public.bump_product_version()
returns trigger
language plpgsql
as $$
begin
  new.row_version = coalesce(old.row_version, 0) + 1;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_bump_version on public.products;
create trigger products_bump_version
  before update on public.products
  for each row
  execute function public.bump_product_version();

-- 3) Log overlapping stock writes (detection aid — does not block sales)
create table if not exists public.sync_conflict_log (
  id bigserial primary key,
  table_name text not null,
  record_id text not null,
  detail jsonb,
  created_at timestamptz default now()
);

create or replace function public.log_product_stock_jump()
returns trigger
language plpgsql
as $$
begin
  -- Large unexpected stock jump may indicate multi-till offline conflict
  if old.stock_quantity is distinct from new.stock_quantity
     and abs(coalesce(new.stock_quantity,0) - coalesce(old.stock_quantity,0)) > 50 then
    insert into public.sync_conflict_log(table_name, record_id, detail)
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

alter table public.sync_conflict_log enable row level security;
drop policy if exists "anon all sync_conflict_log" on public.sync_conflict_log;
create policy "anon all sync_conflict_log" on public.sync_conflict_log
  for all using (true) with check (true);
