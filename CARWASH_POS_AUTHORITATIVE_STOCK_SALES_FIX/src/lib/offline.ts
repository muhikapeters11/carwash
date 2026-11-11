/**
 * Offline detection + mutation queue (sales + product stock updates).
 * Flush runs in background — UI never freezes.
 */
import { isSupabaseConfigured, supabase } from './supabase';
import { serverCompleteSale, serverRecordCreditPayment, serverReceiveStock, serverSetStockOnce } from './api';
import { pushProduct, pushProductPatch, deleteProductRemote, deleteHeldSaleRemote } from './sync';
import type { Product, Sale } from '../types';

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export type OfflineSaleJob = {
  id: string;
  type: 'sale';
  payload: {
    method: 'cash' | 'credit';
    creditorName?: string;
    cashierId: string;
    cashierName: string;
    discountPercent?: number;
    items: { product_id: string; qty: number }[];
    localSale: Sale;
  };
  created_at: string;
  tries: number;
};

export type OfflineStockReceiveJob = { id: string; type: 'stock_receive'; payload: Parameters<typeof serverReceiveStock>[0]; created_at: string; tries: number };
export type OfflineStockAuditJob = { id: string; type: 'stock_audit'; payload: Parameters<typeof serverSetStockOnce>[0]; created_at: string; tries: number };

export type OfflineProductPatchJob = { id: string; type: 'product_patch'; productId: string; payload: Partial<Product>; created_at: string; tries: number };

export type OfflineProductJob = {
  id: string;
  type: 'product';
  payload: Product;
  created_at: string;
  tries: number;
};

export type CloudTable = 'expenses' | 'stock_receives' | 'activity_logs' | 'app_settings' | 'held_sales';
export type OfflineCreditPaymentJob = {
  id: string;
  type: 'credit_payment';
  payload: { creditId: string; amount: number; by: string; byName: string; clientPaymentId: string };
  created_at: string;
  tries: number;
};
export type OfflineCloudUpsertJob = {
  id: string;
  type: 'cloud_upsert';
  table: CloudTable;
  payload: Record<string, unknown>;
  created_at: string;
  tries: number;
};

export type OfflineCloudDeleteJob = {
  id: string;
  type: 'cloud_delete';
  table: 'held_sales';
  rowId: string;
  created_at: string;
  tries: number;
};
export type OfflineProductDeleteJob = {
  id: string;
  type: 'product_delete';
  productId: string;
  created_at: string;
  tries: number;
};

export type OfflineJob = OfflineSaleJob | OfflineProductJob | OfflineProductPatchJob | OfflineStockReceiveJob | OfflineStockAuditJob | OfflineCreditPaymentJob | OfflineCloudUpsertJob | OfflineCloudDeleteJob | OfflineProductDeleteJob;

const QUEUE_KEY = 'carwash-offline-queue';

export function loadQueue(): OfflineJob[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const q = JSON.parse(raw);
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export function saveQueue(q: OfflineJob[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota */
  }
}

/** Wipe the offline mutation queue (factory reset / logout cleanup). */
export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

/** Remove any queued product upserts for this id so a delete cannot be undone by flush. */
export function removeProductFromQueue(productId: string): void {
  try {
    const q = loadQueue().filter(
      (j) => !((j.type === 'product' && String(j.payload?.id) === String(productId)) || (j.type === 'product_patch' && j.productId === productId) || (j.type === 'stock_audit' && j.payload.productId === productId) || (j.type === 'stock_receive' && j.payload.productId === productId))
    );
    saveQueue(q);
  } catch {
    /* ignore */
  }
}

export function enqueueStockReceive(payload: OfflineStockReceiveJob['payload']): void {
  if (!isSupabaseConfigured) return;
  const job: OfflineStockReceiveJob = { id: `stock-receive:${payload.receiveId}`, type: 'stock_receive', payload, created_at: new Date().toISOString(), tries: 0 };
  const q = loadQueue();
  if (!q.some((x) => x.id === job.id)) { q.push(job); saveQueue(q); }
  if (isOnline()) void flushOfflineQueue();
}

export function enqueueStockAudit(payload: OfflineStockAuditJob['payload']): void {
  if (!isSupabaseConfigured) return;
  const job: OfflineStockAuditJob = { id: `stock-audit:${payload.adjustmentId}`, type: 'stock_audit', payload, created_at: new Date().toISOString(), tries: 0 };
  const q = loadQueue();
  if (!q.some((x) => x.id === job.id)) { q.push(job); saveQueue(q); }
  if (isOnline()) void flushOfflineQueue();
}

export function enqueueSale(job: Omit<OfflineSaleJob, 'tries'>): void {
  const q = loadQueue();
  if (!q.some((item) => item.type === 'sale' && item.payload.localSale.id === job.payload.localSale.id)) {
    q.push({ ...job, tries: 0 });
    saveQueue(q);
  }
}

/** Queue a credit collection with a stable ID; server RPC is idempotent. */
export function enqueueCreditPayment(payload: OfflineCreditPaymentJob['payload']): void {
  if (!isSupabaseConfigured) return;
  const id = `credit-payment:${payload.clientPaymentId}`;
  const q = loadQueue();
  if (!q.some((job) => job.id === id)) {
    q.push({ id, type: 'credit_payment', payload, created_at: new Date().toISOString(), tries: 0 });
    saveQueue(q);
  }
  if (isOnline()) void flushOfflineQueue();
}

/** Durable outbox for non-sale cloud records. Always queue first, then flush. */
export function enqueueCloudDelete(table: 'held_sales', rowId: string): void {
  if (!isSupabaseConfigured) return;
  const job: OfflineCloudDeleteJob = { id: `delete:${table}:${rowId}`, type: 'cloud_delete', table, rowId, created_at: new Date().toISOString(), tries: 0 };
  const q = loadQueue().filter((item) => item.id !== job.id);
  q.push(job);
  saveQueue(q);
  if (isOnline()) void flushOfflineQueue();
}

export function enqueueProductDelete(productId: string): void {
  if (!isSupabaseConfigured) return;
  const job: OfflineProductDeleteJob = { id: `delete-product:${productId}`, type: 'product_delete', productId, created_at: new Date().toISOString(), tries: 0 };
  const q = loadQueue().filter((item) => item.id !== job.id);
  q.push(job);
  saveQueue(q);
  if (isOnline()) void flushOfflineQueue();
}

export function enqueueCloudUpsert(table: CloudTable, payload: Record<string, unknown>): void {
  if (!isSupabaseConfigured) return;
  const id = String(payload.id || crypto.randomUUID());
  const q = loadQueue();
  const existing = q.findIndex((job) => job.type === 'cloud_upsert' && job.table === table && String(job.payload.id) === id);
  const job: OfflineCloudUpsertJob = {
    id: `${table}:${id}`,
    type: 'cloud_upsert',
    table,
    payload: { ...payload, id },
    created_at: new Date().toISOString(),
    tries: existing >= 0 && q[existing].type === 'cloud_upsert' ? q[existing].tries : 0,
  };
  if (existing >= 0) q[existing] = job;
  else q.push(job);
  saveQueue(q);
  if (isOnline()) void flushOfflineQueue();
}

/** Queue latest product snapshot (receive / audit / edit). Dedupes by product id. */
function queueLatestProduct(product: Product): void {
  const q = loadQueue().filter((j) => !(j.type === 'product' && j.payload.id === product.id));
  q.push({ id: crypto.randomUUID(), type: 'product', payload: product, created_at: new Date().toISOString(), tries: 0 });
  saveQueue(q);
}

export function enqueueProductPatch(productId: string, patch: Partial<Product>): void {
  if (!isSupabaseConfigured) return;
  const id = `product-patch:${productId}`;
  const q = loadQueue();
  const existing = q.findIndex((j) => j.id === id && j.type === 'product_patch');
  const prior = existing >= 0 && q[existing].type === 'product_patch' ? q[existing].payload : {};
  const job: OfflineProductPatchJob = { id, type: 'product_patch', productId, payload: { ...prior, ...patch }, created_at: new Date().toISOString(), tries: 0 };
  if (existing >= 0) q[existing] = job; else q.push(job);
  saveQueue(q);
  if (isOnline()) void flushOfflineQueue();
}

export function enqueueProduct(product: Product): void {
  if (!isSupabaseConfigured) return;
  if (!isOnline()) { queueLatestProduct(product); return; }
  // Failed online writes are queued instead of being silently lost.
  void pushProduct(product)
    .then(async (res) => {
      if (!res.ok) {
        queueLatestProduct(product);
        return;
      }
      const publicUrl = (res as { imageUrl?: string }).imageUrl;
      if (publicUrl && product.image_url?.startsWith('data:image/')) {
        try {
          const { useStore } = await import('../store/useStore');
          useStore.setState((s) => ({
            products: s.products.map((p) =>
              p.id === product.id ? { ...p, image_url: publicUrl } : p
            ),
          }));
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => queueLatestProduct(product));
}

let flushing = false;

/** Permanent business failures — do not keep retrying forever. */
function isPermanentSaleRejection(error: string | undefined): boolean {
  if (!error) return false;
  return /in stock|unavailable|Invalid product|Cart is empty|Missing sale id|Creditor name|Invalid payment|Discount must/i.test(
    error
  );
}

const MAX_SALE_TRIES = 8;

export async function flushOfflineQueue(
  onSaleSynced?: (
    localId: string,
    serverSale: Sale,
    stockUpdates?: { id: string; stock: number }[]
  ) => void,
  onSaleRejected?: (
    localId: string,
    error: string,
    items: { product_id: string; qty: number }[]
  ) => void
): Promise<{ sales: number; products: number; rejected: number }> {
  const result = { sales: 0, products: 0, rejected: 0 };
  if (!isSupabaseConfigured || !isOnline() || flushing) return result;
  flushing = true;
  try {
    const q = loadQueue();
    const initialById = new Map(q.map((job) => [job.id, JSON.stringify(job)]));
    const processedIds = new Set(q.map((job) => job.id));
    const remain: OfflineJob[] = [];
    for (const job of q) {
      try {
        if (job.type === 'sale') {
          const res = await serverCompleteSale({
            method: job.payload.method,
            creditorName: job.payload.creditorName,
            cashierId: job.payload.cashierId,
            cashierName: job.payload.cashierName,
            discountPercent: job.payload.discountPercent,
            clientSaleId: job.payload.localSale.id,
            items: job.payload.items,
          });
          if (res.ok && res.sale) {
            onSaleSynced?.(
              job.payload.localSale.id,
              res.sale,
              res.stockUpdates
            );
            result.sales += 1;
            await new Promise((r) => setTimeout(r, 20));
            continue;
          }
          const errMsg = res.ok === false ? res.error : 'Sale sync failed';
          job.tries = (job.tries || 0) + 1;
          // Permanent rejection or too many tries → drop job and let UI restore stock.
          if (isPermanentSaleRejection(errMsg) || job.tries >= MAX_SALE_TRIES) {
            onSaleRejected?.(
              job.payload.localSale.id,
              errMsg || 'Sale could not be synced',
              job.payload.items || []
            );
            result.rejected += 1;
            continue;
          }
          // Transient failure: keep for retry. Idempotency makes same clientSaleId safe.
          remain.push(job);
        } else if (job.type === 'stock_receive') {
          const res = await serverReceiveStock(job.payload);
          if (res.ok) { result.products += 1; continue; }
          job.tries += 1; remain.push(job);
        } else if (job.type === 'stock_audit') {
          const res = await serverSetStockOnce(job.payload);
          if (res.ok) { result.products += 1; continue; }
          job.tries += 1; remain.push(job);
        } else if (job.type === 'credit_payment') {
          const res = await serverRecordCreditPayment(job.payload);
          if (res.ok) continue;
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'product_patch') {
          const res = await pushProductPatch(job.productId, job.payload);
          if (res.ok) {
            // Replace local data: URL with durable Storage URL so refresh/other devices keep the photo.
            if (res.imageUrl && job.payload?.image_url?.startsWith?.('data:image/')) {
              try {
                const { useStore } = await import('../store/useStore');
                useStore.setState((s) => ({
                  products: s.products.map((p) =>
                    p.id === job.productId ? { ...p, image_url: res.imageUrl } : p
                  ),
                }));
              } catch { /* ignore */ }
            }
            continue;
          }
          job.tries += 1; remain.push(job);
        } else if (job.type === 'product') {
          // Existing products must never receive a stale full-row stock snapshot.
          // New products still use a full insert/upsert; existing rows get metadata only.
          // Images are uploaded to Storage (not stripped) so photos sync across devices.
          const { data: existingProduct, error: lookupError } = await supabase.from('products').select('id').eq('id', job.payload.id).maybeSingle();
          if (lookupError) { job.tries += 1; remain.push(job); continue; }
          const { stock: _ignoredStock, ...metadata } = job.payload;
          const res = existingProduct
            ? await pushProductPatch(job.payload.id, metadata)
            : await pushProduct(job.payload);
          if (res.ok) {
            const publicUrl = (res as { imageUrl?: string }).imageUrl;
            if (publicUrl && job.payload?.image_url?.startsWith?.('data:image/')) {
              try {
                const { useStore } = await import('../store/useStore');
                useStore.setState((s) => ({
                  products: s.products.map((p) =>
                    p.id === job.payload.id ? { ...p, image_url: publicUrl } : p
                  ),
                }));
              } catch { /* ignore */ }
            }
            result.products += 1;
            await new Promise((r) => setTimeout(r, 20));
            continue;
          }
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'cloud_upsert') {
          const { error } = await supabase.from(job.table).upsert(job.payload);
          if (!error) continue;
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'cloud_delete') {
          const { ok } = await deleteHeldSaleRemote(job.rowId);
          if (ok) continue;
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'product_delete') {
          const { ok } = await deleteProductRemote(job.productId);
          if (ok) continue;
          job.tries += 1;
          remain.push(job);
        } else {
          remain.push(job);
        }
      } catch {
        job.tries += 1;
        remain.push(job);
      }
    }
    // Preserve jobs added/updated while this flush was in flight.
    const latest = loadQueue();
    const arrivedDuringFlush = latest.filter((job) =>
      !processedIds.has(job.id) || initialById.get(job.id) !== JSON.stringify(job)
    );
    const remainIds = new Set(remain.map((job) => job.id));
    saveQueue([...remain, ...arrivedDuringFlush.filter((job) => !remainIds.has(job.id))]);
  } finally {
    flushing = false;
  }
  return result;
}

export function subscribeOnline(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}

/** Test helper: simulate queue contents */
export function __testQueueStats() {
  const q = loadQueue();
  return {
    total: q.length,
    sales: q.filter((j) => j.type === 'sale').length,
    products: q.filter((j) => j.type === 'product').length,
    cloud: q.filter((j) => j.type === 'cloud_upsert' || j.type === 'credit_payment' || j.type === 'cloud_delete' || j.type === 'product_delete').length,
  };
}
