-- =============================================================================
-- Acceptance-test probes for stock deduction persistence
-- Replace the placeholder UUIDs, then run after each manual test step.
-- Does not modify data (read-only), except the optional negative-stock probe
-- at the bottom which is expected to FAIL.
-- =============================================================================

-- A/B: product stock + latest sales
-- select id, name, stock from public.products where id = '<product-uuid>';
-- select id, receipt_no, total, created_at from public.sales order by created_at desc limit 5;
-- select sale_id, product_id, quantity from public.sale_items order by id desc limit 10;

-- Constraint present?
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname = 'products_stock_non_negative';

-- complete_sale signature (should include p_client_sale_id uuid)
select pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'complete_sale';

-- Optional destructive probe (expect ERROR: products_stock_non_negative):
-- begin;
-- update public.products set stock = -1 where id = '<test-product-uuid>';
-- rollback;
