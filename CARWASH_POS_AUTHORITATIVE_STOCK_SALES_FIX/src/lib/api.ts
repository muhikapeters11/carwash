/**
 * Server-side operations when Supabase is configured.
 * Stock deduction runs inside a Postgres transaction (row lock).
 */
import { supabase, isSupabaseConfigured } from './supabase';
import type { Sale, CartItem, UserProfile, Product } from '../types';

export type CompleteSalePayload = {
  method: 'cash' | 'credit';
  creditorName?: string;
  cashierId: string;
  cashierName: string;
  discountPercent?: number;
  clientSaleId?: string;
  items: { product_id: string; qty: number }[];
};

export type CompleteSaleResult =
  | { ok: true; sale: Sale; stockUpdates: { id: string; stock: number }[] }
  | { ok: false; error: string };

/** Atomic sale + stock deduct on server */
export async function serverCompleteSale(
  payload: CompleteSalePayload
): Promise<CompleteSaleResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Server not configured' };
  }

  const { data, error } = await supabase.rpc('complete_sale', {
    p_cashier_id: payload.cashierId,
    p_cashier_name: payload.cashierName,
    p_method: payload.method,
    p_creditor_name: payload.creditorName || null,
    p_discount_percent: payload.discountPercent || 0,
    p_items: payload.items,
    p_client_sale_id: payload.clientSaleId || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data || data.ok !== true) {
    return { ok: false, error: String(data?.error || 'Sale failed') };
  }

  const sale = data.sale as Sale;
  const stockUpdates = (data.stock_updates || []) as { id: string; stock: number }[];
  return { ok: true, sale, stockUpdates };
}

export async function serverRecordCreditPayment(opts: {
  creditId: string;
  amount: number;
  by: string;
  byName: string;
  clientPaymentId: string;
}): Promise<{ ok: boolean; error?: string; paid?: number }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Server not configured' };
  const { data, error } = await supabase.rpc('record_credit_payment_once', {
    p_credit_id: opts.creditId,
    p_amount: opts.amount,
    p_by: opts.by,
    p_by_name: opts.byName,
    p_client_payment_id: opts.clientPaymentId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: String(data?.error || 'Failed') };
  return { ok: true, paid: data.paid };
}

export function cartToServerItems(cart: CartItem[]) {
  return cart.map((c) => ({ product_id: c.product.id, qty: c.quantity }));
}


export async function serverReceiveStock(opts: {
  receiveId: string; productId: string; productName: string; quantity: number; barrels?: number;
  unitCost: number; totalCost: number; receiptNo?: string; supplier?: string;
  receivedBy?: string; receivedByName?: string; createdAt: string;
}): Promise<{ ok: boolean; error?: string; stock?: number; cost?: number }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Server not configured' };
  const { data, error } = await supabase.rpc('record_stock_receive_once', {
    p_receive_id: opts.receiveId, p_product_id: opts.productId, p_product_name: opts.productName,
    p_quantity: opts.quantity, p_barrels: opts.barrels ?? null, p_unit_cost: opts.unitCost,
    p_total_cost: opts.totalCost, p_receipt_no: opts.receiptNo || null, p_supplier: opts.supplier || null,
    p_received_by: opts.receivedBy || null, p_received_by_name: opts.receivedByName || null,
    p_created_at: opts.createdAt,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: String(data?.error || 'Stock receive failed') };
  return { ok: true, stock: Number(data.stock), cost: Number(data.cost) };
}

export async function serverSetStockOnce(opts: {
  adjustmentId: string; productId: string; delta: number; reason?: string; by?: string; byName?: string; createdAt: string;
}): Promise<{ ok: boolean; error?: string; stock?: number }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Server not configured' };
  const { data, error } = await supabase.rpc('set_product_stock_once', {
    p_adjustment_id: opts.adjustmentId, p_product_id: opts.productId, p_delta: opts.delta,
    p_reason: opts.reason || null, p_by: opts.by || null, p_by_name: opts.byName || null, p_created_at: opts.createdAt,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: String(data?.error || 'Stock adjustment failed') };
  return { ok: true, stock: Number(data.stock) };
}

/** Load all profiles from Supabase (for Users tab + permissions) */
export async function fetchProfiles(): Promise<UserProfile[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, permissions, is_active')
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id),
    email: String(r.email || ''),
    pin: '',
    full_name: String(r.full_name || 'User'),
    role: (r.role as 'admin' | 'cashier') || 'cashier',
    permissions: (r.permissions as string[]) || [],
    is_active: r.is_active !== false,
  }));
}

/** Update permissions on a profile in Supabase */
export async function updateProfilePermissions(
  id: string,
  permissions: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase
    .from('profiles')
    .update({ permissions })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Update name / active on profile */
export async function updateProfileFields(
  id: string,
  fields: { full_name?: string; is_active?: boolean; role?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase.from('profiles').update(fields).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Load products from Supabase so all devices share stock */
export async function fetchProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('sku', { ascending: true });
  if (error || !data) return [];
  return data as Product[];
}

/** Upsert a product to Supabase */
export async function upsertProduct(product: Partial<Product> & { id: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase.from('products').upsert(product);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Load recent sales from Supabase */
export async function fetchRecentSales(limit = 200): Promise<Sale[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((s: any) => ({
    id: s.id,
    receipt_no: s.receipt_no,
    total: Number(s.total),
    cost_total: Number(s.cost_total || 0),
    payment_method: s.payment_method,
    creditor_name: s.creditor_name,
    cashier_id: s.cashier_id,
    cashier_name: s.cashier_name,
    created_at: s.created_at,
    is_credit_collection: s.is_credit_collection,
    items: (s.sale_items || []).map((it: any) => ({
      product_id: it.product_id,
      name: it.product_name,
      qty: Number(it.quantity),
      price: Number(it.unit_price),
      cost: Number(it.unit_cost || 0),
    })),
  }));
}
