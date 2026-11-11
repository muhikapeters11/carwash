/**
 * Multi-device cloud sync — optimised for speed.
 */
import { supabase, isSupabaseConfigured } from './supabase';
import type { Product, Sale, UserProfile, Credit, Expense, AppSettings } from '../types';

type ActivityRow = {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  details?: string;
  created_at: string;
};

export type PullResult = {
  products: Product[];
  sales: Sale[];
  profiles: UserProfile[];
  credits: Credit[];
  expenses: Expense[];
  settings: Partial<AppSettings> | null;
  activityLogs: ActivityRow[];
  stockReceives: any[];
  heldSales: any[];
};

const uploadedImageUrls = new Map<string, { source: string; url: string }>();

const emptyPull = (): PullResult => ({
  products: [],
  sales: [],
  profiles: [],
  credits: [],
  expenses: [],
  settings: null,
  activityLogs: [],
  stockReceives: [],
  heldSales: [],
});

function mapProduct(r: any, prevImage?: string): Product {
  const img = r.image_url || prevImage || undefined;
  // Avoid keeping multi‑MB base64 in tight loops — keep reference only
  return {
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    category: r.category,
    price: Number(r.price),
    cost: Number(r.cost),
    stock: Number(r.stock),
    low_stock_threshold: Number(r.low_stock_threshold ?? 10),
    image_url: img,
    is_barrel: !!r.is_barrel,
    barrel_cups: r.barrel_cups ?? 100,
    is_active: r.is_active !== false,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapSales(rows: any[]): Sale[] {
  return (rows || []).map((s: any) => ({
    id: String(s.id),
    receipt_no: s.receipt_no,
    total: Number(s.total),
    cost_total: Number(s.cost_total || 0),
    payment_method: s.payment_method,
    creditor_name: s.creditor_name || undefined,
    cashier_id: s.cashier_id,
    cashier_name: s.cashier_name,
    created_at: s.created_at,
    is_credit_collection: !!s.is_credit_collection,
    items: (s.sale_items || []).map((it: any) => ({
      product_id: it.product_id,
      name: it.product_name,
      qty: Number(it.quantity),
      price: Number(it.unit_price),
      cost: Number(it.unit_cost || 0),
    })),
  }));
}

/** Full pull — login / first load */
export async function pullAllData(prevProducts: Product[] = []): Promise<PullResult> {
  if (!isSupabaseConfigured) return emptyPull();
  const imgMap = new Map(prevProducts.map((p) => [p.id, p.image_url]));

  const [prodRes, salesRes, profRes, credRes, expRes, setRes, actRes, recvRes, heldRes] = await Promise.all([
    // Product images are stored as Storage URLs and pulled with the product rows.
    supabase
      .from('products')
      .select(
        'id,sku,name,category,price,cost,stock,low_stock_threshold,is_barrel,barrel_cups,is_active,created_at,updated_at,image_url'
      )
      .order('sku', { ascending: true }),
    supabase
      .from('sales')
      .select('id,receipt_no,total,cost_total,payment_method,creditor_name,cashier_id,cashier_name,created_at,is_credit_collection,sale_items(product_id,product_name,quantity,unit_price,unit_cost)')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('profiles')
      .select('id, email, full_name, role, permissions, is_active')
      .order('created_at', { ascending: true }),
    supabase
      .from('credits')
      .select('id,customer_name,amount,paid_amount,remaining,sale_id,created_at,credit_payments(id,credit_id,amount,paid_at,recorded_by)')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('expenses').select('id,description,amount,category,note,created_by,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('app_settings').select('id,pub_name,logo_url,login_bg_url,till_number,receipt_footer,currency,factory_reset_at,business_day_hour,receipt_show_cost').eq('id', 1).maybeSingle(),
    supabase.from('activity_logs').select('id,user_id,user_name,action,details,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('stock_receives').select('id,product_id,product_name,quantity,barrels,unit_cost,total_cost,receipt_no,supplier,received_by,received_by_name,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('held_sales').select('*').order('created_at', { ascending: false }).limit(200),
  ]);

  // A failed query must never be interpreted as an empty table. This was
  // causing products/reports to disappear whenever RLS or the network failed.
  const queryErrors = [prodRes, salesRes, profRes, credRes, expRes, setRes, actRes, recvRes, heldRes]
    .filter((r: any) => r?.error)
    .map((r: any) => r.error.message || 'Cloud sync query failed');
  if (queryErrors.length) throw new Error(queryErrors.join(' | '));

  const products = (prodRes.data || []).map((r: any) =>
    mapProduct(r, imgMap.get(String(r.id)))
  );

  let settings: Partial<AppSettings> | null = null;
  if (setRes.data) {
    const r = setRes.data as any;
    settings = {
      pub_name: r.pub_name || 'My Pub',
      logo_url: r.logo_url || undefined,
      login_bg_url: r.login_bg_url || undefined,
      till_number: r.till_number || 'TILL-001',
      receipt_footer: r.receipt_footer || '',
      currency: 'KES',
      factory_reset_at: r.factory_reset_at || undefined,
      business_day_hour: Number(r.business_day_hour ?? 9),
      receipt_show_cost: !!r.receipt_show_cost,
    };
  }

  return {
    products,
    sales: mapSales(salesRes.data || []),
    profiles: (profRes.data || []).map((r: any) => ({
      id: String(r.id),
      email: String(r.email || ''),
      pin: '',
      full_name: String(r.full_name || 'User'),
      role: (r.role as 'admin' | 'cashier') || 'cashier',
      permissions: (r.permissions as string[]) || [],
      is_active: r.is_active !== false,
    })),
    credits: (credRes.data || []).map((c: any) => ({
      id: String(c.id),
      customer_name: c.customer_name,
      amount: Number(c.amount),
      paid_amount: Number(c.paid_amount || 0),
      remaining: Number(c.remaining ?? c.amount - (c.paid_amount || 0)),
      sale_id: c.sale_id,
      created_at: c.created_at,
      payments: (c.credit_payments || []).map((p: any) => ({
        id: String(p.id),
        credit_id: String(p.credit_id),
        amount: Number(p.amount),
        paid_at: p.paid_at || p.created_at,
        recorded_by: p.recorded_by,
      })),
    })),
    expenses: (expRes.data || []).map((e: any) => ({
      id: String(e.id),
      description: e.description,
      amount: Number(e.amount),
      category: e.category || 'misc',
      note: e.note || undefined,
      created_by: e.created_by,
      created_at: e.created_at,
    })),
    settings,
    activityLogs: (actRes.data || []).map((a: any) => ({
      id: String(a.id),
      user_id: String(a.user_id || ''),
      user_name: String(a.user_name || ''),
      action: String(a.action || ''),
      details: a.details || undefined,
      created_at: a.created_at,
    })),
    stockReceives: recvRes.data || [],
    heldSales: (heldRes.data || []).map((h: any) => {
      const rawItems = Array.isArray(h.items) ? h.items : [];
      const items = rawItems
        .map((it: any) => {
          const product = it?.product || it;
          if (!product || !product.id) return null;
          return {
            product: {
              id: String(product.id),
              sku: String(product.sku || ''),
              name: String(product.name || 'Item'),
              category: product.category || 'beer',
              price: Number(product.price) || 0,
              cost: Number(product.cost) || 0,
              stock: Number(product.stock) || 0,
              low_stock_threshold: Number(product.low_stock_threshold ?? 10),
              is_barrel: !!product.is_barrel,
              barrel_cups: product.barrel_cups,
              is_active: product.is_active !== false,
              image_url: product.image_url,
            },
            quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
          };
        })
        .filter(Boolean);
      return {
        id: String(h.id),
        customer_name: h.customer_name || 'Held',
        items,
        created_at: h.created_at,
        expires_at: h.expires_at,
      };
    }).filter((h: any) => !h.expires_at || new Date(h.expires_at) > new Date()),
  };
}

/** Lightweight poll — stock, sales, credits, profiles and reset metadata. */
export async function pullHotData(prevProducts: Product[] = []): Promise<Partial<PullResult>> {
  if (!isSupabaseConfigured) return {};
  const imgMap = new Map(prevProducts.map((p) => [p.id, p.image_url]));

  // Hot pull = everything other devices need to stay in lockstep (web / desktop / phone).
  const [prodRes, salesRes, credRes, profRes, setRes, heldRes, expRes, recvRes, actRes] = await Promise.all([
    supabase
      .from('products')
      .select('id,sku,name,category,price,cost,stock,low_stock_threshold,is_barrel,barrel_cups,is_active,updated_at,image_url')
      .order('sku', { ascending: true }),
    supabase
      .from('sales')
      .select('id,receipt_no,total,cost_total,payment_method,creditor_name,cashier_id,cashier_name,created_at,is_credit_collection,sale_items(product_id,product_name,quantity,unit_price,unit_cost)')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('credits')
      .select('id,customer_name,amount,paid_amount,remaining,sale_id,created_at,credit_payments(id,credit_id,amount,paid_at,recorded_by)')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('profiles').select('id,email,full_name,role,permissions,is_active').order('created_at', { ascending: true }),
    supabase.from('app_settings').select('id,pub_name,logo_url,login_bg_url,till_number,receipt_footer,currency,factory_reset_at,business_day_hour,receipt_show_cost').eq('id', 1).maybeSingle(),
    supabase.from('held_sales').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('expenses').select('id,description,amount,category,note,created_by,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('stock_receives').select('id,product_id,product_name,quantity,barrels,unit_cost,total_cost,receipt_no,supplier,received_by,received_by_name,created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('activity_logs').select('id,user_id,user_name,action,details,created_at').order('created_at', { ascending: false }).limit(1000),
  ]);

  const queryErrors = [prodRes, salesRes, credRes, profRes, setRes, heldRes, expRes, recvRes, actRes]
    .filter((r: any) => r?.error)
    .map((r: any) => r.error.message || 'Cloud sync query failed');
  if (queryErrors.length) throw new Error(queryErrors.join(' | '));

  const settings = setRes.data ? {
    pub_name: setRes.data.pub_name || 'My Pub',
    logo_url: setRes.data.logo_url || undefined,
    login_bg_url: setRes.data.login_bg_url || undefined,
    till_number: setRes.data.till_number || 'TILL-001',
    receipt_footer: setRes.data.receipt_footer || '',
    currency: 'KES',
    factory_reset_at: setRes.data.factory_reset_at || undefined,
    business_day_hour: Number(setRes.data.business_day_hour ?? 9),
    receipt_show_cost: !!setRes.data.receipt_show_cost,
  } : null;

  const heldSales = (heldRes.data || []).map((h: any) => {
    const rawItems = Array.isArray(h.items) ? h.items : [];
    const items = rawItems
      .map((it: any) => {
        const product = it?.product || it;
        if (!product || !product.id) return null;
        return {
          product: {
            id: String(product.id),
            sku: String(product.sku || ''),
            name: String(product.name || 'Item'),
            category: product.category || 'beer',
            price: Number(product.price) || 0,
            cost: Number(product.cost) || 0,
            stock: Number(product.stock) || 0,
            low_stock_threshold: Number(product.low_stock_threshold ?? 10),
            is_barrel: !!product.is_barrel,
            barrel_cups: product.barrel_cups,
            is_active: product.is_active !== false,
            image_url: product.image_url,
          },
          quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
        };
      })
      .filter(Boolean);
    return {
      id: String(h.id),
      customer_name: h.customer_name || 'Held',
      items,
      created_at: h.created_at,
      expires_at: h.expires_at,
    };
  }).filter((h: any) => !h.expires_at || new Date(h.expires_at) > new Date());

  return {
    products: (prodRes.data || []).map((r: any) => mapProduct(r, imgMap.get(String(r.id)))),
    profiles: (profRes.data || []).map((r: any) => ({
      id: String(r.id), email: String(r.email || ''), pin: '',
      full_name: String(r.full_name || 'User'),
      role: (r.role as 'admin' | 'cashier') || 'cashier',
      permissions: (r.permissions as string[]) || [], is_active: r.is_active !== false,
    })),
    settings,
    sales: mapSales(salesRes.data || []),
    credits: (credRes.data || []).map((c: any) => ({
      id: String(c.id),
      customer_name: c.customer_name,
      amount: Number(c.amount),
      paid_amount: Number(c.paid_amount || 0),
      remaining: Number(c.remaining ?? c.amount - (c.paid_amount || 0)),
      sale_id: c.sale_id,
      created_at: c.created_at,
      payments: (c.credit_payments || []).map((p: any) => ({
        id: String(p.id),
        credit_id: String(p.credit_id),
        amount: Number(p.amount),
        paid_at: p.paid_at || p.created_at,
        recorded_by: p.recorded_by,
      })),
    })),
    heldSales,
    expenses: (expRes.data || []).map((e: any) => ({
      id: String(e.id),
      description: e.description,
      amount: Number(e.amount),
      category: e.category || 'misc',
      note: e.note || undefined,
      created_by: e.created_by,
      created_at: e.created_at,
    })),
    stockReceives: recvRes.data || [],
    activityLogs: (actRes.data || []).map((a: any) => ({
      id: String(a.id),
      user_id: a.user_id,
      user_name: a.user_name || '',
      action: a.action || '',
      details: a.details || undefined,
      created_at: a.created_at,
    })),
  };
}

let localPushDone = false;

export function resetLocalProductPushFlag(): void {
  localPushDone = false;
}

export async function pushLocalProductsIfNeeded(local: Product[]): Promise<number> {
  if (!isSupabaseConfigured || !local.length || localPushDone) return 0;
  const { data, error } = await supabase.from('products').select('id,sku,image_url');
  if (error || !data) return 0;
  // Import tombstone check lazily to avoid circular deps at module load.
  const { isProductTombstoned } = await import('./tombstones');
  const byId = new Map<string, any>((data || []).map((r: any) => [String(r.id), r]));
  const bySku = new Map<string, any>((data || []).map((r: any) => [String(r.sku).toLowerCase(), r]));
  let n = 0;
  let failed = false;
  for (const p of local) {
    if (isProductTombstoned(p.id)) continue;
    const remote = byId.get(p.id) || bySku.get(p.sku.toLowerCase());
    if (remote) {
      // Backfill legacy locally-cached photos that were never uploaded because
      // their original base64 strings exceeded the old size cutoff.
      // Existing product rows are cloud-authoritative for stock. Never upsert a
      // local full-row snapshot during bootstrap: it could undo sales on another device.
      continue;
    }
    const res = await pushProduct(p);
    if (res.ok) n += 1; else failed = true;
  }
  if (!failed) localPushDone = true;
  return n;
}


export async function pushProductPatch(id: string, patch: Partial<Product>): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  const allowed: Record<string, unknown> = {};
  const keys: (keyof Product)[] = ['sku','name','category','price','cost','low_stock_threshold','is_barrel','barrel_cups','is_active'];
  for (const key of keys) if (patch[key] !== undefined) allowed[key] = patch[key];
  // Never upload a base64 image through a row update. Existing cloud image remains
  // intact; normal URL image changes can be applied directly.
  if (patch.image_url && !patch.image_url.startsWith('data:image/')) allowed.image_url = patch.image_url;
  if (!Object.keys(allowed).length) return { ok: true };
  const { error } = await supabase.from('products').update({ ...allowed, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function pushProduct(p: Product): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  let cloudImageUrl = p.image_url || null;
  if (cloudImageUrl?.startsWith('data:image/')) {
    try {
      const cachedImage = uploadedImageUrls.get(p.id);
      let publicUrl = cachedImage?.source === cloudImageUrl ? cachedImage.url : undefined;
      if (!publicUrl) {
        let blob = await (await fetch(cloudImageUrl)).blob();
        // Also repair legacy, oversized photos already stored in local cache.
        if (blob.size > 180_000 && typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(blob);
          const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
            if (compressed && compressed.size < blob.size) blob = compressed;
          }
          bitmap.close();
        }
        const ext = blob.type.includes('png') ? 'png' : 'jpg';
        const path = `${p.id}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('product-images').upload(path, blob, {
          upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '3600',
        });
        if (uploadError) throw uploadError;
        publicUrl = supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
        if (!publicUrl) throw new Error('Storage did not return a public image URL');
        uploadedImageUrls.set(p.id, { source: cloudImageUrl, url: publicUrl });
      }
      if (!publicUrl) throw new Error('Product image URL is unavailable');
      cloudImageUrl = publicUrl;
    } catch (e: any) {
      return { ok: false, error: `Product image upload failed: ${e?.message || 'storage unavailable'}` };
    }
  }
  const row: any = {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: p.price,
    cost: p.cost,
    stock: p.stock,
    low_stock_threshold: p.low_stock_threshold,
    is_barrel: !!p.is_barrel,
    barrel_cups: p.barrel_cups ?? 100,
    is_active: p.is_active !== false,
    updated_at: new Date().toISOString(),
    // Include the image on every upsert so a stock-only update cannot erase it.
    image_url: cloudImageUrl,
  };
  const { error } = await supabase.from('products').upsert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteProductRemote(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  const pid = String(id);

  // 1) Prefer hard-delete RPC (nulls FKs then deletes the row).
  try {
    const { data, error } = await supabase.rpc('hard_delete_product', { p_product_id: pid });
    if (!error && data?.ok === true) return { ok: true };
  } catch {
    /* RPC may be missing */
  }

  // 2) Direct DELETE — product must actually leave the table so pulls cannot restore it.
  const { error: delErr } = await supabase.from('products').delete().eq('id', pid);
  if (!delErr) return { ok: true };

  // 3) Last resort: soft-delete + client filters inactive/tombstoned on pull.
  const { error: softErr } = await supabase
    .from('products')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', pid);
  if (softErr) {
    return { ok: false, error: softErr.message || delErr.message || 'Delete failed' };
  }
  return { ok: true };
}

export async function deleteHeldSaleRemote(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  const { error } = await supabase.from('held_sales').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function pushExpense(e: Expense): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  const { error } = await supabase.from('expenses').upsert({
    id: e.id,
    description: e.description,
    amount: e.amount,
    category: e.category || 'misc',
    note: e.note || null,
    created_by: e.created_by,
    created_at: e.created_at,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function pushStockReceive(row: {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  receipt_no?: string;
  supplier?: string;
  received_by?: string;
  created_at: string;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.from('stock_receives').upsert({
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    barrels: (row as any).barrels ?? null,
    received_by_name: (row as any).received_by_name ?? null,
    unit_cost: row.unit_cost,
    total_cost: row.total_cost,
    receipt_no: row.receipt_no || null,
    supplier: row.supplier || null,
    received_by: row.received_by || null,
    created_at: row.created_at,
  });
}

export async function pushSettings(s: AppSettings): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'not configured' };
  const { error } = await supabase.from('app_settings').upsert({
    id: 1,
    pub_name: s.pub_name || 'My Pub',
    logo_url: s.logo_url || null,
    login_bg_url: s.login_bg_url || null,
    till_number: s.till_number || 'TILL-001',
    receipt_footer: s.receipt_footer || '',
    currency: 'KES',
    business_day_hour: s.business_day_hour ?? 9,
    receipt_show_cost: !!s.receipt_show_cost,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function subscribeRealtime(onChange: () => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Coalesce related transaction events (sale + items + credit) without
  // imposing multi-second lag on other devices.
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(), 120);
  };
  const channel = supabase
    .channel('pos-cloud-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_receives' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'credits' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_payments' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'held_sales' }, debounced)
    .subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

/** Admin-only cloud cleanup that preserves every staff profile and settings. */
export async function clearProductsAndReports(
  adminPin: string,
  adminId: string
): Promise<{ ok: boolean; error?: string; factoryResetAt?: string; productsDeleted?: number; salesDeleted?: number }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('clear_products_and_reports', {
    p_pin: adminPin, p_admin_id: adminId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: String(data?.error || 'Cloud cleanup failed') };
  return {
    ok: true,
    factoryResetAt: data.factory_reset_at ? String(data.factory_reset_at) : undefined,
    productsDeleted: Number(data.products_deleted || 0),
    salesDeleted: Number(data.sales_deleted || 0),
  };
}

/**
 * Wipe all business data on Supabase (products, sales, credits, etc.).
 * Keeps only the confirming admin so the POS can be set up again.
 * Requires the signed-in admin ID and PIN (verified server-side).
 */
export async function wipeCloudData(adminPin: string, adminId: string): Promise<{ ok: boolean; error?: string; productsDeleted?: number; salesDeleted?: number }> {
  if (!isSupabaseConfigured) return { ok: true };
  try {
    const { data, error } = await supabase.rpc('factory_reset_cloud', { p_pin: adminPin, p_admin_id: adminId });
    if (error) {
      return { ok: false, error: `${error.message || 'Cloud wipe failed'}${error.code ? ` [${error.code}]` : ''}` };
    }
    const payload = data as { ok?: boolean; error?: string; message?: string; sqlstate?: string; products_deleted?: number; sales_deleted?: number } | null;
    if (!payload || payload.ok !== true) {
      return { ok: false, error: `${payload?.error || 'Cloud wipe rejected'}${payload?.sqlstate ? ` [SQLSTATE ${payload.sqlstate}]` : ''}` };
    }
    return { ok: true, productsDeleted: Number(payload?.products_deleted || 0), salesDeleted: Number(payload?.sales_deleted || 0) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Cloud wipe failed' };
  }
}
