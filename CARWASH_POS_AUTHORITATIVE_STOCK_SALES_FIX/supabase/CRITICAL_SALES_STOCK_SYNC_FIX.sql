-- =============================================================================
-- Carwash POS — Critical sales and stock movement repair
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
      select coalesce(json_agg(json_build_object('id', p.id, 'stock', p.stock)), '[]'::json)
        into stock_updates
        from public.sale_items si join public.products p on p.id = si.product_id
        where si.sale_id = existing_sale.id;
      return json_build_object(
        'ok', true,
        'stock_updates', stock_updates,
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

ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS barrels numeric(12,2);
ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS received_by_name text;

-- Atomic, idempotent stock receipt. This replaces client-side product upserts
-- for receive-stock so stale snapshots can never put stock back after a sale.
CREATE OR REPLACE FUNCTION public.record_stock_receive_once(
  p_receive_id uuid, p_product_id uuid, p_product_name text, p_quantity numeric,
  p_barrels numeric, p_unit_cost numeric, p_total_cost numeric, p_receipt_no text,
  p_supplier text, p_received_by uuid, p_received_by_name text, p_created_at timestamptz
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE prod public.products%rowtype; existing public.stock_receives%rowtype; new_stock numeric; new_cost numeric;
BEGIN
  IF p_receive_id IS NULL OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Invalid stock receipt');
  END IF;
  SELECT * INTO existing FROM public.stock_receives WHERE id = p_receive_id;
  IF FOUND THEN
    SELECT * INTO prod FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Product unavailable'); END IF;
    RETURN json_build_object('ok', true, 'stock', prod.stock, 'cost', prod.cost, 'duplicate', true);
  END IF;
  SELECT * INTO prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Product unavailable'); END IF;
  new_stock := prod.stock + p_quantity;
  new_cost := CASE WHEN new_stock > 0 THEN
    ((prod.cost * prod.stock) + (coalesce(p_unit_cost, 0) * p_quantity)) / new_stock
    ELSE coalesce(p_unit_cost, prod.cost) END;
  UPDATE public.products SET stock = new_stock, cost = round(new_cost, 2), updated_at = now()
    WHERE id = p_product_id RETURNING * INTO prod;
  INSERT INTO public.stock_receives (
    id, product_id, product_name, quantity, barrels, unit_cost, total_cost,
    receipt_no, supplier, received_by, received_by_name, created_at
  ) VALUES (
    p_receive_id, p_product_id, coalesce(p_product_name, prod.name), p_quantity, p_barrels,
    coalesce(p_unit_cost, 0), coalesce(p_total_cost, 0), nullif(p_receipt_no, ''),
    nullif(p_supplier, ''), p_received_by, p_received_by_name, coalesce(p_created_at, now())
  );
  RETURN json_build_object('ok', true, 'stock', prod.stock, 'cost', prod.cost, 'duplicate', false);
EXCEPTION WHEN others THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END; $$;
GRANT EXECUTE ON FUNCTION public.record_stock_receive_once(uuid, uuid, text, numeric, numeric, numeric, numeric, text, text, uuid, text, timestamptz) TO anon, authenticated, service_role;

-- Durable idempotency ledger for physical stock counts / inventory audits.
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  previous_stock numeric NOT NULL, new_stock numeric NOT NULL, reason text,
  adjusted_by uuid, adjusted_by_name text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.set_product_stock_once(
  p_adjustment_id uuid, p_product_id uuid, p_delta numeric, p_reason text,
  p_by uuid, p_by_name text, p_created_at timestamptz
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE prod public.products%rowtype; prior public.stock_adjustments%rowtype; old_stock numeric;
BEGIN
  IF p_adjustment_id IS NULL OR p_product_id IS NULL OR p_delta IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Invalid stock count');
  END IF;
  SELECT * INTO prior FROM public.stock_adjustments WHERE id = p_adjustment_id;
  IF FOUND THEN
    SELECT * INTO prod FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Product unavailable'); END IF;
    RETURN json_build_object('ok', true, 'stock', prod.stock, 'duplicate', true);
  END IF;
  SELECT * INTO prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Product unavailable'); END IF;
  old_stock := prod.stock;
  IF old_stock + p_delta < 0 THEN RETURN json_build_object('ok', false, 'error', 'Stock adjustment would make stock negative'); END IF;
  UPDATE public.products SET stock = old_stock + p_delta, updated_at = now() WHERE id = p_product_id RETURNING * INTO prod;
  INSERT INTO public.stock_adjustments(id, product_id, previous_stock, new_stock, reason, adjusted_by, adjusted_by_name, created_at)
  VALUES (p_adjustment_id, p_product_id, old_stock, prod.stock, p_reason, p_by, p_by_name, coalesce(p_created_at, now()));
  RETURN json_build_object('ok', true, 'stock', prod.stock, 'duplicate', false);
EXCEPTION WHEN others THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_product_stock_once(uuid, uuid, numeric, text, uuid, text, timestamptz) TO anon, authenticated, service_role;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_adjustments;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
END $$;
NOTIFY pgrst, 'reload schema';
