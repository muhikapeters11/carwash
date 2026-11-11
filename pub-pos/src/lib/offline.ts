/**
 * Offline detection + mutation queue (sales + product stock updates).
 * Flush runs in background — UI never freezes.
 */
import { isSupabaseConfigured, supabase } from './supabase';
import { serverCompleteSale, serverRecordCreditPayment } from './api';
import { pushProduct, deleteProductRemote, deleteHeldSaleRemote } from './sync';
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

export type OfflineJob = OfflineSaleJob | OfflineProductJob | OfflineCreditPaymentJob | OfflineCloudUpsertJob | OfflineCloudDeleteJob | OfflineProductDeleteJob;

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
      (j) => !(j.type === 'product' && String(j.payload?.id) === String(productId))
    );
    saveQueue(q);
  } catch {
    /* ignore */
  }
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

export function enqueueProduct(product: Product): void {
  if (!isSupabaseConfigured) return;
  if (!isOnline()) { queueLatestProduct(product); return; }
  // Failed online writes are queued instead of being silently lost.
  void pushProduct(product).then((res) => { if (!res.ok) queueLatestProduct(product); })
    .catch(() => queueLatestProduct(product));
}

let flushing = false;

export async function flushOfflineQueue(
  onSaleSynced?: (
    localId: string,
    serverSale: Sale,
    stockUpdates?: { id: string; stock: number }[]
  ) => void
): Promise<{ sales: number; products: number }> {
  const result = { sales: 0, products: 0 };
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
          // Keep rejected/pending sales for reconciliation; never silently drop a
          // locally completed sale after a fixed retry count. Idempotency makes
          // retrying the same clientSaleId safe.
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'credit_payment') {
          const res = await serverRecordCreditPayment(job.payload);
          if (res.ok) continue;
          job.tries += 1;
          remain.push(job);
        } else if (job.type === 'product') {
          const res = await pushProduct(job.payload);
          if (res.ok) {
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
