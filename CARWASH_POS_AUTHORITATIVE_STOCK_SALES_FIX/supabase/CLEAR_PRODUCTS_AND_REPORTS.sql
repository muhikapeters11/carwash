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
