-- Fast POS checkout: add client-generated sale IDs for safe background retries.
-- Run once in Supabase SQL Editor. Existing sales are not changed.
drop function if exists public.complete_sale(uuid, text, text, text, numeric, jsonb);
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

  for item in select * from jsonb_array_elements(p_items)
  loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'qty')::numeric;
    update public.products
      set stock = stock - qty
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

  insert into public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection, created_at
  ) values (
    sale_id, receipt, total, cost_total, p_method, nullif(trim(coalesce(p_creditor_name, '')), ''),
    p_cashier_id, p_cashier_name, false, now()
  );

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

grant execute on function public.complete_sale(uuid, text, text, text, numeric, jsonb, uuid) to anon, authenticated, service_role;
