-- CARWASH POS: authoritative, atomic, idempotent sale + stock deduction
-- Run this file ONCE in the Supabase SQL Editor for the project used by all tills.
-- Online checkout is considered complete only after this RPC returns ok=true.
-- Offline checkout stays local/pending until it can call this same RPC.

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
  item record;
  prod public.products%rowtype;
  subtotal numeric := 0;
  cost_total numeric := 0;
  discount numeric := 0;
  total numeric := 0;
  sale_id uuid := coalesce(p_client_sale_id, gen_random_uuid());
  existing_sale public.sales%rowtype;
  receipt text;
  stock_updates json := '[]'::json;
  line_items json := '[]'::json;
  new_stock numeric;
begin
  -- Idempotent retry: a previously committed sale must never deduct twice.
  if p_client_sale_id is not null then
    select * into existing_sale from public.sales where id = p_client_sale_id;
    if found then
      select coalesce(json_agg(json_build_object('id', p.id, 'stock', p.stock)), '[]'::json)
        into stock_updates
        from public.sale_items si
        join public.products p on p.id = si.product_id
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
    return json_build_object('ok', false, 'error', 'Invalid payment method');
  end if;
  if p_method = 'credit' and coalesce(length(trim(p_creditor_name)), 0) = 0 then
    return json_build_object('ok', false, 'error', 'Creditor name required');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'Cart is empty');
  end if;

  -- Lock products in a stable order and aggregate duplicate product lines.
  -- This prevents overselling when the same product appears more than once.
  for item in
    select x.product_id, sum(x.qty)::numeric as qty
      from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric)
     group by x.product_id
     order by x.product_id
  loop
    if item.product_id is null or item.qty is null or item.qty <= 0 then
      return json_build_object('ok', false, 'error', 'Invalid product or quantity');
    end if;
    select * into prod from public.products where id = item.product_id for update;
    if not found or prod.is_active is false then
      return json_build_object('ok', false, 'error', 'Product unavailable');
    end if;
    if coalesce(prod.stock, 0) < item.qty then
      return json_build_object('ok', false, 'error', prod.name || ': insufficient stock (available ' || coalesce(prod.stock, 0)::text || ')');
    end if;
    subtotal := subtotal + prod.price * item.qty;
    cost_total := cost_total + prod.cost * item.qty;
  end loop;

  if coalesce(p_discount_percent, 0) < 0 or coalesce(p_discount_percent, 0) > 100 then
    return json_build_object('ok', false, 'error', 'Invalid discount percentage');
  end if;
  discount := round(subtotal * coalesce(p_discount_percent, 0) / 100.0, 2);
  total := greatest(0, round(subtotal - discount, 2));
  receipt := 'R' || to_char(now(), 'YYMMDDHH24MISS') || upper(substr(replace(sale_id::text, '-', ''), 1, 5));

  -- Insert parent first (sale_items FK), then stock changes and item rows.
  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    sale_id, receipt, total, cost_total, p_method,
    nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

  for item in
    select x.product_id, sum(x.qty)::numeric as qty
      from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric)
     group by x.product_id
     order by x.product_id
  loop
    update public.products
       set stock = stock - item.qty, updated_at = now()
     where id = item.product_id
     returning * into prod;
    new_stock := prod.stock;

    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (sale_id, prod.id, prod.name, item.qty, prod.price, prod.cost);

    stock_updates := stock_updates || json_build_array(json_build_object('id', prod.id, 'stock', new_stock));
    line_items := line_items || json_build_array(json_build_object(
      'product_id', prod.id, 'name', prod.name, 'qty', item.qty,
      'price', prod.price, 'cost', prod.cost
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
      'id', sale_id, 'receipt_no', receipt, 'total', total,
      'cost_total', cost_total, 'payment_method', p_method,
      'creditor_name', nullif(trim(coalesce(p_creditor_name, '')), ''),
      'cashier_id', p_cashier_id, 'cashier_name', p_cashier_name,
      'created_at', now(), 'is_credit_collection', false, 'items', line_items
    )
  );
exception when unique_violation then
  -- Concurrent retry with the same client ID: return the already committed sale.
  select * into existing_sale from public.sales where id = sale_id;
  if found then
    return json_build_object('ok', true, 'sale', json_build_object(
      'id', existing_sale.id, 'receipt_no', existing_sale.receipt_no,
      'total', existing_sale.total, 'cost_total', existing_sale.cost_total,
      'payment_method', existing_sale.payment_method, 'creditor_name', existing_sale.creditor_name,
      'cashier_id', existing_sale.cashier_id, 'cashier_name', existing_sale.cashier_name,
      'created_at', existing_sale.created_at, 'is_credit_collection', existing_sale.is_credit_collection,
      'items', coalesce((select json_agg(json_build_object('product_id', si.product_id, 'name', si.product_name,
        'qty', si.quantity, 'price', si.unit_price, 'cost', si.unit_cost)) from public.sale_items si where si.sale_id = existing_sale.id), '[]'::json)
    ), 'stock_updates', '[]'::json);
  end if;
  return json_build_object('ok', false, 'error', 'Duplicate sale/receipt conflict');
when others then
  return json_build_object('ok', false, 'error', sqlerrm, 'sqlstate', sqlstate);
end;
$$;

grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid)
  to anon, authenticated, service_role;

-- Keep the products table in Supabase Realtime so connected tills see committed stock.
do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
