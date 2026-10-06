-- Tighter RLS example: enable after Auth is configured.
-- For single-bar trusted devices, open policies in schema.sql are OK.
-- Replace business_id checks with your tenant claim when using JWT.

-- Example: drop open policies
-- drop policy if exists "anon all sales" on sales;
-- create policy "authenticated read sales" on sales for select to authenticated using (true);
-- create policy "authenticated insert sales" on sales for insert to authenticated with check (true);

-- Prefer: Supabase Auth + business_id column on all tables
-- alter table sales add column if not exists business_id text;
-- create policy "tenant sales" on sales for all using (
--   business_id = (auth.jwt() ->> 'business_id')
-- ) with check (
--   business_id = (auth.jwt() ->> 'business_id')
-- );

-- Never put service_role key in the client app.
