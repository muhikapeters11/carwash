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
  v_stock_updates json := '[]'::json;
  v_line_items json := '[]'::json;
begin
  -- Every app checkout supplies a stable UUID. It makes network retries safe.
  if p_client_sale_id is null then
    return json_build_object('ok', false, 'error', 'Missing sale id. Please retry checkout.');
  end if;
  v_sale_id := p_client_sale_id;

  -- Serialize retries of the same sale id before checking for an existing sale.
  -- This prevents two simultaneous requests from deducting the same sale twice.
  perform pg_advisory_xact_lock(hashtextextended(v_sale_id::text, 0));

  select * into v_existing from public.sales where id = v_sale_id;
  if found then
    select coalesce(json_agg(json_build_object('id', p.id, 'stock', p.stock)), '[]'::json)
      into v_stock_updates
      from public.sale_items si
      join public.products p on p.id = si.product_id
     where si.sale_id = v_existing.id;

    return json_build_object(
      'ok', true,
      'duplicate', true,
      'stock_updates', v_stock_updates,
      'sale', json_build_object(
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
          select json_agg(json_build_object(
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
    return json_build_object('ok', false, 'error', 'Invalid payment method.');
  end if;
  if p_method = 'credit' and coalesce(length(trim(p_creditor_name)), 0) = 0 then
    return json_build_object('ok', false, 'error', 'Creditor name is required.');
  end if;
  if coalesce(p_discount_percent, 0) < 0 or coalesce(p_discount_percent, 0) > 100 then
    return json_build_object('ok', false, 'error', 'Discount must be between 0 and 100 percent.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty.');
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
      return json_build_object('ok', false, 'error', 'Invalid product or quantity.');
    end if;

    select * into v_product
      from public.products
     where id = v_item.product_id
     for update;

    if not found or v_product.is_active is false then
      return json_build_object('ok', false, 'error', 'A product is unavailable.');
    end if;
    if coalesce(v_product.stock, 0) < v_item.qty then
      return json_build_object(
        'ok', false,
        'error', v_product.name || ': only ' || coalesce(v_product.stock, 0)::text || ' in stock.'
      );
    end if;

    v_subtotal := v_subtotal + v_product.price * v_item.qty;
    v_cost_total := v_cost_total + v_product.cost * v_item.qty;
  end loop;

  v_discount := round(v_subtotal * coalesce(p_discount_percent, 0) / 100.0, 2);
  v_total := greatest(0, round(v_subtotal - v_discount, 2));
  v_receipt := 'R' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || upper(substr(replace(v_sale_id::text, '-', ''), 1, 5));

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

    v_stock_updates := v_stock_updates || json_build_array(
      json_build_object('id', v_product.id, 'stock', v_product.stock)
    );
    v_line_items := v_line_items || json_build_array(json_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'qty', v_item.qty,
      'price', v_product.price,
      'cost', v_product.cost
    ));
  end loop;

  if v_discount > 0 then
    v_line_items := v_line_items || json_build_array(json_build_object(
      'product_id', '_discount', 'name', 'Discount', 'qty', 1, 'price', -v_discount, 'cost', 0
    ));
  end if;

  if p_method = 'credit' then
    insert into public.credits (customer_name, amount, paid_amount, sale_id)
    values (trim(p_creditor_name), v_total, 0, v_sale_id);
  end if;

  return json_build_object(
    'ok', true,
    'duplicate', false,
    'stock_updates', v_stock_updates,
    'sale', json_build_object(
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

-- Stock changes must notify all connected POS clients.
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'supabase_realtime publication is not available; enable Realtime for public.products in Supabase Dashboard.';
end $$;
