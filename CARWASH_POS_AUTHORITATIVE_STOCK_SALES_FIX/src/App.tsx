import React, { useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useStore, hydrateSessionUser } from './store/useStore';
import Login from './pages/Login';
import Layout from './components/Layout';
import { isSupabaseConfigured } from './lib/supabase';
import { pullAllData, pullHotData, subscribeRealtime, pushLocalProductsIfNeeded } from './lib/sync';
import { flushOfflineQueue, subscribeOnline, isOnline, clearOfflineQueue, enqueueProduct } from './lib/offline';
import { clearOfflineAuth } from './lib/offlineAuth';
import {
  filterTombstonedProducts,
  filterTombstonedHeld,
  isProductTombstoned,
  clearAllTombstones,
} from './lib/tombstones';

// Critical POS tabs: eager load for instant open (ms, not seconds)
import Dashboard from './pages/Dashboard';
import Sell from './pages/Sell';
import ReceiveStock from './pages/ReceiveStock';
import Products from './pages/Products';
import Credit from './pages/Credit';
// Less-used tabs stay lazy
const InventoryAudit = lazy(() => import('./pages/InventoryAudit'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Settings = lazy(() => import('./pages/Settings'));


/** Reverse a locally-pending sale that the server permanently rejected. */
function handleRejectedOfflineSale(
  localId: string,
  error: string,
  items: { product_id: string; qty: number }[]
) {
  useStore.setState((s) => {
    const qtyByProduct = new Map<string, number>();
    for (const line of items) {
      if (!line?.product_id) continue;
      qtyByProduct.set(
        line.product_id,
        (qtyByProduct.get(line.product_id) || 0) + Number(line.qty || 0)
      );
    }
    return {
      // Restore stock that was optimistically deducted offline.
      products: s.products.map((p) =>
        qtyByProduct.has(p.id)
          ? { ...p, stock: Number(p.stock) + (qtyByProduct.get(p.id) || 0) }
          : p
      ),
      // Drop the ghost sale from local history.
      sales: s.sales.filter((sale) => sale.id !== localId),
      // Also drop any local credit created for that offline sale.
      credits: s.credits.filter((c) => c.sale_id !== localId),
    };
  });
  try {
    useStore.getState().addNotification({
      title: 'Offline sale not synced',
      message: `A pending sale could not be accepted by the server (${error}). Local stock was restored.`,
      type: 'sale',
      related_id: localId,
    });
  } catch {
    /* ignore */
  }
}

function applyPull(data: Awaited<ReturnType<typeof pullAllData>> | Partial<Awaited<ReturnType<typeof pullAllData>>>) {
  const st = useStore.getState();
  let cloudResetDetected = false;
  const cloudResetAt = data.settings?.factory_reset_at;

  // A cloud factory reset must invalidate every other till's stale local cache
  // and pending upload queue before any queued write can repopulate the cloud.
  if (cloudResetAt) {
    let seenResetAt = '';
    try { seenResetAt = localStorage.getItem('pub-pos-cloud-reset-at') || ''; } catch { /* ignore */ }
    if (seenResetAt !== cloudResetAt) {
      cloudResetDetected = true;
      clearOfflineQueue();
      clearOfflineAuth();
      try { localStorage.setItem('pub-pos-cloud-reset-at', cloudResetAt); } catch { /* ignore */ }
    }
  }

  const patch: Record<string, any> = {};
  if (cloudResetDetected) {
    Object.assign(patch, {
      products: [], sales: [], credits: [], expenses: [], heldSales: [], cart: [],
      stockReceives: [], activityLogs: [], notifications: [], staffUsers: [],
      activeTab: 'dashboard',
    });
  }

  // Cloud products are authoritative, including inactive rows.
  // Keep inactive products in the store so Products admin can toggle them;
  // Sell already filters is_active !== false. Only tombstoned (deleted) are dropped.
  if (data.products !== undefined) {
    patch.products = filterTombstonedProducts(data.products || []);
  }
  if (data.profiles !== undefined) {
    patch.staffUsers = data.profiles;
    if (st.currentUser) {
      const match = data.profiles.find((p) => p.id === st.currentUser!.id);
      if (!match) {
        st.setCurrentUser(null);
      } else {
        patch.currentUser = {
          ...st.currentUser,
          full_name: match.full_name || st.currentUser.full_name,
          role: match.role || st.currentUser.role,
          permissions: Array.isArray(match.permissions) && match.permissions.length
            ? match.permissions
            : st.currentUser.permissions,
          is_active: match.is_active !== false,
        };
      }
    }
  }
  if (data.sales !== undefined) {
    const remoteIds = new Set(data.sales.map((sale) => sale.id));
    const pendingLocal = cloudResetDetected
      ? []
      : st.sales.filter((sale) => !remoteIds.has(sale.id)).slice(0, 30);
    patch.sales = [...pendingLocal, ...data.sales].slice(0, 1000);
  }
  if (data.credits !== undefined) {
    const cloudCredits = data.credits || [];
    // Keep local-only credits (cashier credit sales not yet flushed) so they
    // remain visible on the admin Credit tab until the cloud catches up.
    const remoteCreditIds = new Set(cloudCredits.map((c) => c.id));
    const remoteSaleIds = new Set((data.sales || st.sales).map((s) => s.id));
    const pendingLocalCredits = cloudResetDetected
      ? []
      : st.credits.filter(
          (c) =>
            !remoteCreditIds.has(c.id) &&
            // Prefer matching by sale_id when the sale is still only local
            (!c.sale_id || !remoteSaleIds.has(c.sale_id) || !cloudCredits.some((rc) => rc.sale_id === c.sale_id))
        );
    // Prefer cloud credit when both exist for the same sale
    const cloudBySale = new Set(cloudCredits.map((c) => c.sale_id).filter(Boolean));
    const mergedLocal = pendingLocalCredits.filter((c) => !c.sale_id || !cloudBySale.has(c.sale_id));
    patch.credits = [...mergedLocal, ...cloudCredits];
  }
  if (data.expenses !== undefined) patch.expenses = data.expenses;
  if (data.settings) patch.settings = { ...st.settings, ...data.settings, currency: 'KES' };
  if (data.activityLogs !== undefined) patch.activityLogs = data.activityLogs;
  if (data.stockReceives !== undefined) patch.stockReceives = data.stockReceives;
  if (data.heldSales !== undefined) {
    // Cloud is authoritative for shared holds, but never drop a local hold that
    // has not reached the cloud yet (upsert lag / offline). Also drop expired
    // and tombstoned rows so deleted/expired holds cannot flicker back in.
    const now = Date.now();
    const cloudHeld = filterTombstonedHeld(
      (data.heldSales || []).filter(
        (h: { expires_at?: string }) => !h.expires_at || new Date(h.expires_at).getTime() > now
      )
    );
    if (cloudResetDetected) {
      patch.heldSales = cloudHeld;
    } else {
      const cloudIds = new Set(cloudHeld.map((h: { id: string }) => h.id));
      const pendingLocal = filterTombstonedHeld(
        st.heldSales.filter(
          (h) =>
            !cloudIds.has(h.id) &&
            (!h.expires_at || new Date(h.expires_at).getTime() > now)
        )
      );
      // Prefer cloud row when the same id exists on both sides
      patch.heldSales = [...pendingLocal, ...cloudHeld];
    }
  }

  // Prefer local product fields that are still uploading (stock, is_active, price…).
  // Without this, a hot pull right after "Inactive" restores the old Active flag.
  if (data.products !== undefined && !cloudResetDetected && patch.products) {
    try {
      const localById = new Map(st.products.map((p) => [p.id, p]));
      const pendingIds = new Set<string>();
      try {
        const raw = localStorage.getItem('carwash-offline-queue');
        const q = raw ? JSON.parse(raw) : [];
        if (Array.isArray(q)) {
          for (const job of q) {
            if (job?.type === 'product' && job.payload?.id) pendingIds.add(String(job.payload.id));
            if (job?.type === 'stock_receive' && job.payload?.productId) pendingIds.add(String(job.payload.productId));
            if (job?.type === 'stock_audit' && job.payload?.productId) pendingIds.add(String(job.payload.productId));
            // Keep this device's provisional stock deduction visible until the queued
            // sale is committed (or explicitly reconciled) by the server.
            if (job?.type === 'sale' && Array.isArray(job.payload?.items)) {
              for (const line of job.payload.items) if (line?.product_id) pendingIds.add(String(line.product_id));
            }
          }
        }
      } catch {
        /* ignore */
      }
      // Recent edits guard (set by updateProduct / addProduct) — survives until cloud catches up.
      let recent: Record<string, { at: number; is_active?: boolean; stock?: number; price?: number; cost?: number; name?: string }> = {};
      try {
        recent = JSON.parse(sessionStorage.getItem('pub-pos-product-guards') || '{}');
      } catch {
        recent = {};
      }
      const now = Date.now();
      const freshRecent: typeof recent = {};
      for (const [id, g] of Object.entries(recent)) {
        if (now - (g.at || 0) < 30_000) freshRecent[id] = g;
      }
      try {
        sessionStorage.setItem('pub-pos-product-guards', JSON.stringify(freshRecent));
      } catch {
        /* ignore */
      }

      patch.products = (patch.products as typeof data.products).map((cloudP) => {
        if (isProductTombstoned(cloudP.id)) return cloudP;
        const local = localById.get(cloudP.id);
        const guard = freshRecent[cloudP.id];
        if (!local && !guard) return cloudP;
        let next = { ...cloudP };
        if (guard) {
          if (typeof guard.is_active === 'boolean') next.is_active = guard.is_active;
          if (typeof guard.stock === 'number') next.stock = guard.stock;
          if (typeof guard.price === 'number') next.price = guard.price;
          if (typeof guard.cost === 'number') next.cost = guard.cost;
          if (typeof guard.name === 'string') next.name = guard.name;
        }
        // Keep optimistic stock while a pending outbox job (sale / receive / audit)
        // still owns this product. Metadata guards above are independent.
        if (local && pendingIds.has(cloudP.id) && Number(local.stock) !== Number(next.stock)) {
          next = { ...next, stock: local.stock };
        }
        // Product photos: prefer a durable cloud URL. If the cloud row has no
        // image yet (or only a stale data: URL) but this device still has a
        // local photo, keep the local image until Storage upload finishes.
        if (local?.image_url) {
          const cloudImg = next.image_url ? String(next.image_url) : '';
          const localImg = String(local.image_url);
          const cloudIsDurable = cloudImg.startsWith('http://') || cloudImg.startsWith('https://');
          const localIsData = localImg.startsWith('data:image/');
          if (!cloudIsDurable && localImg) {
            next = { ...next, image_url: localImg };
          } else if (cloudIsDurable) {
            next = { ...next, image_url: cloudImg };
          } else if (localIsData) {
            next = { ...next, image_url: localImg };
          }
        }
        return next;
      });

      // Retain purely local products still waiting to upload — never resurrect tombstones.
      const cloudIds = new Set((data.products || []).map((p) => p.id));
      const missingLocal = st.products.filter(
        (p) => !cloudIds.has(p.id) && !isProductTombstoned(p.id)
      );
      if (missingLocal.length) {
        patch.products = [...patch.products, ...missingLocal];
      }
      patch.products = filterTombstonedProducts(patch.products);
    } catch {
      /* ignore merge errors */
    }
  }

  if (cloudResetDetected) {
    clearAllTombstones();
  }

  // Apply the entire cloud response in one store update to reduce rerenders and
  // local-storage persistence work while the cashier is selling.
  if (Object.keys(patch).length) useStore.setState(patch);
  if (data.products !== undefined || data.sales !== undefined || data.credits !== undefined) {
    useStore.getState().setLastSyncAt?.(new Date().toISOString());
  }
}

hydrateSessionUser();

export default function App() {
  const currentUser = useStore((s) => s.currentUser);
  const activeTab = useStore((s) => s.activeTab);
  const cleanExpiredHolds = useStore((s) => s.cleanExpiredHolds);
  const theme = useStore((s) => s.theme);
  const businessDayHour = useStore((s) => s.settings.business_day_hour);
  const syncing = useRef(false);

  const setSyncIndicator = (value: boolean) => {
    window.dispatchEvent(new CustomEvent('pub-pos-sync-status', { detail: { syncing: value } }));
  };

  const syncFull = useCallback(async () => {
    if (!isSupabaseConfigured || !useStore.getState().currentUser) return;
    if (!isOnline()) return;
    if (syncing.current) return;
    syncing.current = true;
    setSyncIndicator(true);
    try {
      const st = useStore.getState();
      // Pull first. If this is a first-time cloud setup (no reset marker change)
      // and cloud has no products yet, migrate the locally persisted catalog once.
      let data = await pullAllData(st.products);
      const previousReset = (() => { try { return localStorage.getItem('pub-pos-cloud-reset-at') || ''; } catch { return ''; } })();
      const cloudResetChanged = !!data.settings?.factory_reset_at && data.settings.factory_reset_at !== previousReset;
      if (!cloudResetChanged && st.products.length > 0) {
        await pushLocalProductsIfNeeded(st.products);
        data = await pullAllData(st.products);
        // Never drop locally saved products if an upload is still retrying.
        // Queue missing rows and keep them visible until a later cloud pull confirms them.
        const cloudIds = new Set(data.products.map((p) => p.id));
        const cloudSkus = new Set(data.products.map((p) => p.sku.toLowerCase()));
        const notYetInCloud = st.products.filter((p) => !cloudIds.has(p.id) && !cloudSkus.has(p.sku.toLowerCase()));
        if (notYetInCloud.length) {
          notYetInCloud.forEach((p) => enqueueProduct(p));
          data.products = [...data.products, ...notYetInCloud];
        }
      }
      applyPull(data);
      await flushOfflineQueue(
        (localId, serverSale, stockUpdates) => {
          useStore.setState((s) => {
            const stockMap = new Map((stockUpdates || []).map((u) => [u.id, u.stock]));
            return {
              sales: s.sales.map((x) => (x.id === localId ? serverSale : x)),
              products: s.products.map((p) =>
                stockMap.has(p.id) ? { ...p, stock: stockMap.get(p.id)! } : p
              ),
            };
          });
        },
        handleRejectedOfflineSale
      );
    } catch (e) {
      console.warn('full sync failed', e);
    } finally {
      syncing.current = false;
      setSyncIndicator(false);
    }
  }, []);

  const syncHot = useCallback(async () => {
    if (!isSupabaseConfigured || !useStore.getState().currentUser) return;
    if (!isOnline()) return;
    if (syncing.current) return;
    syncing.current = true;
    setSyncIndicator(true);
    try {
      const st = useStore.getState();
      const data = await pullHotData(st.products);
      applyPull(data);
      // Reconcile offline sales through the same atomic RPC and immediately apply
      // the authoritative sale + stock returned by Supabase on every sync path.
      const flushed = await flushOfflineQueue(
        (localId, serverSale, stockUpdates) => {
          useStore.setState((s) => {
            const stockMap = new Map((stockUpdates || []).map((u) => [u.id, u.stock]));
            return {
              sales: s.sales.map((x) => (x.id === localId ? serverSale : x)),
              products: s.products.map((p) =>
                stockMap.has(p.id) ? { ...p, stock: stockMap.get(p.id)! } : p
              ),
            };
          });
        },
        handleRejectedOfflineSale
      );
      // Pull once more after any queued sale commits (or is rejected) so the
      // screen reflects the persisted database state.
      if (flushed.sales > 0 || flushed.rejected > 0) {
        applyPull(await pullHotData(useStore.getState().products));
      }
    } catch (e) {
      console.warn('hot sync failed', e);
    } finally {
      syncing.current = false;
      setSyncIndicator(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (typeof businessDayHour === 'number') {
      void import('./utils/businessDay').then(({ setBusinessDayCutOffHour }) => {
        setBusinessDayCutOffHour(businessDayHour);
      });
    }
  }, [businessDayHour]);

  useEffect(() => {
    const interval = setInterval(cleanExpiredHolds, 60_000);
    cleanExpiredHolds();
    return () => clearInterval(interval);
  }, [cleanExpiredHolds]);

  useEffect(() => {
    if (!currentUser) return;
    const onManualRefresh = () => {
      if (isSupabaseConfigured && isOnline()) void syncFull();
      else setSyncIndicator(false);
    };
    window.addEventListener('pub-pos-refresh', onManualRefresh);
    if (!isSupabaseConfigured) {
      return () => window.removeEventListener('pub-pos-refresh', onManualRefresh);
    }

    // Non-blocking initial sync — every device pulls the same cloud catalogue.
    const t = window.setTimeout(() => void syncFull(), 50);

    // Safety net when Realtime is delayed: full pull every 90s.
    const id = setInterval(() => {
      if (!isOnline()) return;
      void syncFull();
    }, 90_000);

    // Short safety poll covers suspended tabs and transient Realtime disconnects.
    // Normal updates arrive through Realtime within a fraction of a second.
    const hotId = setInterval(() => {
      if (!isOnline() || document.visibilityState !== 'visible') return;
      void syncHot();
    }, 5_000);

    const onFocus = () => {
      if (isOnline()) void syncHot();
    };
    window.addEventListener('focus', onFocus);

    const unsubRt = subscribeRealtime(() => {
      if (isOnline()) void syncHot();
    });

    const unsubNet = subscribeOnline(() => {
      if (isOnline()) {
        // Pull cloud first (including factory-reset marker), then flush offline writes.
        void syncFull();
      }
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isOnline()) void syncHot();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // After a local write, nudge a hot pull so other open tabs on this machine refresh.
    const onLocalWrite = () => {
      if (isOnline()) window.setTimeout(() => void syncHot(), 800);
    };
    window.addEventListener('pub-pos-local-write', onLocalWrite);

    return () => {
      clearTimeout(t);
      clearInterval(id);
      clearInterval(hotId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pub-pos-refresh', onManualRefresh);
      window.removeEventListener('pub-pos-local-write', onLocalWrite);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubRt();
      unsubNet();
    };
  }, [currentUser, syncFull, syncHot]);

  if (!currentUser) {
    return <Login />;
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'sell': return <Sell />;
      case 'receive': return <ReceiveStock />;
      case 'products': return <Products />;
      case 'inventory': return <InventoryAudit />;
      case 'credit': return <Credit />;
      case 'expenses': return <Expenses />;
      case 'reports': return <Reports />;
      case 'users': return <Users />;
      case 'activity': return <ActivityLog />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  return (
    <Layout>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading…
          </div>
        }
      >
        {renderTab()}
      </Suspense>
    </Layout>
  );
}
