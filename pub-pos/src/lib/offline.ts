/**
 * Offline detection + mutation queue (sales + product stock updates).
 * Flush runs in background — UI never freezes.
 */
import { isSupabaseConfigured } from './supabase';
import { serverCompleteSale } from './api';
import { pushProduct } from './sync';
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

export type OfflineJob = OfflineSaleJob | OfflineProductJob;

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
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 150)));
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
  q.push({ ...job, tries: 0 });
  saveQueue(q);
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
    let q = loadQueue();
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
        } else if (job.type === 'product') {
          const res = await pushProduct(job.payload);
          if (res.ok) {
            result.products += 1;
            await new Promise((r) => setTimeout(r, 20));
            continue;
          }
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
    saveQueue(remain);
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
  };
}
