-- Multi-device POS sync: run once in Supabase SQL Editor.
-- Enables Realtime change events for every shared business-data table.
-- This does not change existing table data or disable existing RLS policies.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text DEFAULT 'misc';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS barrels numeric(12,2);
ALTER TABLE public.stock_receives ADD COLUMN IF NOT EXISTS received_by_name text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS business_day_hour integer DEFAULT 9;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS receipt_show_cost boolean DEFAULT false;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'products', 'sales', 'sale_items', 'stock_receives', 'expenses',
    'credits', 'credit_payments', 'app_settings', 'profiles',
    'held_sales', 'activity_logs', 'notifications'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN
          RAISE NOTICE 'Realtime publication unavailable while adding %', tbl;
      END;
    END IF;
  END LOOP;
END $$;

-- Make sure the API schema cache sees any recently-created database objects.
NOTIFY pgrst, 'reload schema';


-- Idempotent credit collection RPC. The client-generated UUID is reused for
-- both the payment row and collection sale, so retries cannot double-charge.
CREATE OR REPLACE FUNCTION public.record_credit_payment_once(
  p_credit_id uuid,
  p_amount numeric,
  p_by uuid,
  p_by_name text,
  p_client_payment_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.credits%rowtype;
  paid numeric;
BEGIN
  IF p_client_payment_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Payment id required');
  END IF;

  -- A prior successful attempt means this retry is already complete.
  SELECT amount INTO paid
  FROM public.credit_payments
  WHERE id = p_client_payment_id;
  IF FOUND THEN
    RETURN json_build_object('ok', true, 'paid', paid, 'duplicate', true);
  END IF;

  SELECT * INTO c FROM public.credits WHERE id = p_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Credit not found');
  END IF;
  IF c.remaining <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Already paid');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Invalid amount');
  END IF;

  paid := LEAST(c.remaining, ROUND(p_amount, 2));
  UPDATE public.credits SET paid_amount = paid_amount + paid WHERE id = p_credit_id;
  INSERT INTO public.credit_payments (id, credit_id, amount, recorded_by)
  VALUES (p_client_payment_id, p_credit_id, paid, p_by);
  INSERT INTO public.sales (
    id, receipt_no, total, cost_total, payment_method, creditor_name,
    cashier_id, cashier_name, is_credit_collection
  ) VALUES (
    p_client_payment_id,
    'CR' || RIGHT(REPLACE(p_client_payment_id::text, '-', ''), 8),
    paid, 0, 'credit_collection', c.customer_name, p_by, p_by_name, true
  ) ON CONFLICT (id) DO NOTHING;

  RETURN json_build_object('ok', true, 'paid', paid, 'duplicate', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_credit_payment_once(uuid, numeric, uuid, text, uuid)
  TO anon, authenticated, service_role;
