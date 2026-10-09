import { useEffect, useRef, useCallback, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { Sidebar } from "@/components/layout/Sidebar";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { SellPage } from "@/pages/SellPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { ReceiveStockPage } from "@/pages/ReceiveStockPage";
import { ExpensesPage } from "@/pages/ExpensesPage";
import { CreditsPage } from "@/pages/CreditsPage";
import { ProductsPage } from "@/pages/ProductsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SuppliersPage } from "@/pages/SuppliersPage";
import { UsersPage } from "@/pages/UsersPage";
import { ActivityLogPage } from "@/pages/ActivityLogPage";
import { SettingsPage } from "@/pages/SettingsPage";
import type { FC } from "react";
import type { AppTab } from "@/types";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useProductRealtime } from "@/hooks/useProductRealtime";
import { InputFocusScroll } from "@/components/InputFocusScroll";
import {
  bootstrapLocalDb,
  scheduleDexieSave,
  syncPendingOpsToDexie,
  loadPendingOpsFromDexie,
} from "@/db";
import { useSyncStore, forceCloudSync } from "@/stores/syncStore";

const IDLE_MS = 5 * 60 * 1000;

const PAGES: Record<AppTab, FC> = {
  dashboard: DashboardPage,
  sell: SellPage,
  inventory: InventoryPage,
  receive_stock: ReceiveStockPage,
  expenses: ExpensesPage,
  credits: CreditsPage,
  products: ProductsPage,
  reports: ReportsPage,
  suppliers: SuppliersPage,
  users: UsersPage,
  activity_log: ActivityLogPage,
  settings: SettingsPage,
};

function App() {
  const session = useAppStore((s) => s.session);
  const activeTab = useAppStore((s) => s.activeTab);
  const theme = useAppStore((s) => s.settings?.theme ?? "light");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dbReady, setDbReady] = useState(false);
  useProductRealtime();

  const resetIdle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!useAppStore.getState().session) return;
    timer.current = setTimeout(() => {
      useAppStore.getState().logout();
    }, IDLE_MS);
  }, []);

  // Boot Dexie → hydrate Zustand
  useEffect(() => {
    let unsubApp: (() => void) | undefined;
    let unsubSync: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      // Wait for Zustand localStorage rehydration — otherwise cloud data can be overwritten by defaults
      try {
        const persister = (useAppStore as unknown as {
          persist?: {
            hasHydrated?: () => boolean;
            onFinishHydration?: (cb: () => void) => () => void;
            rehydrate?: () => Promise<void>;
          };
        }).persist;
        if (persister?.rehydrate) {
          await persister.rehydrate();
        } else if (persister && !persister.hasHydrated?.()) {
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            const unsub = persister.onFinishHydration?.(done);
            setTimeout(() => {
              unsub?.();
              resolve();
            }, 1500);
          });
        }
      } catch (e) {
        console.warn("[hydrate]", e);
      }

      const online = typeof navigator !== "undefined" && navigator.onLine;

      // Open local DB + load pending ops (always) — but do NOT apply local catalog
      // as the source of truth when online; cloud wins so every device sees last sync.
      try {
        await bootstrapLocalDb();
        const ops = await loadPendingOpsFromDexie();
        if (!cancelled && ops.length) {
          useSyncStore.setState({ pendingOps: ops });
        }
      } catch (e) {
        console.warn("[boot local]", e);
      }

      if (cancelled) return;

      unsubApp = useAppStore.subscribe((state) => {
        scheduleDexieSave(state);
      });
      unsubSync = useSyncStore.subscribe((s) => {
        void syncPendingOpsToDexie(s.pendingOps);
      });

      if (online) {
        // CLOUD FIRST: discard local default users/catalog so we never show factory PIN/data
        useAppStore.setState({
          users: [],
          products: [],
          sales: [],
          expenses: [],
          suppliers: [],
          credits: [],
          stockReceives: [],
          stockAudits: [],
        });
        useSyncStore.getState().setOnline(true);
        useSyncStore.getState().setCloud({ enabled: true });
        try {
          const result = await Promise.race([
            forceCloudSync({ silent: true }),
            new Promise<{ ok: boolean; message: string }>((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: false,
                    message: "Cloud sync timed out — will use local cache",
                  }),
                25000
              )
            ),
          ]);
          console.info("[boot cloud-first]", result.message);
          // If cloud failed, fall back to local Dexie snapshot
          if (!result.ok) {
            const { loadSnapshotFromDexie } = await import("@/db/bridge");
            const snap = await loadSnapshotFromDexie();
            if (snap && !cancelled) {
              useAppStore.setState({
                products: snap.products?.length ? snap.products : useAppStore.getState().products,
                sales: snap.sales || useAppStore.getState().sales,
                heldSales: snap.heldSales || [],
                credits: snap.credits || [],
                expenses: snap.expenses || [],
                suppliers: snap.suppliers || [],
                users: snap.users?.length ? snap.users : useAppStore.getState().users,
                stockReceives: snap.stockReceives || [],
                stockAudits: snap.stockAudits || [],
                activityLog: snap.activityLog || [],
                ...(snap.settings ? { settings: snap.settings } : {}),
              });
            }
          }
        } catch (e) {
          console.warn("[boot cloud-first]", e);
          try {
            const { loadSnapshotFromDexie } = await import("@/db/bridge");
            const snap = await loadSnapshotFromDexie();
            if (snap && !cancelled) {
              useAppStore.setState({
                products: snap.products?.length ? snap.products : useAppStore.getState().products,
                sales: snap.sales || [],
                users: snap.users?.length ? snap.users : useAppStore.getState().users,
                expenses: snap.expenses || [],
                suppliers: snap.suppliers || [],
                ...(snap.settings ? { settings: snap.settings } : {}),
              });
            }
          } catch { /* ignore */ }
        }
      } else {
        // OFFLINE: load local cache only
        try {
          const { loadSnapshotFromDexie } = await import("@/db/bridge");
          const snap = await loadSnapshotFromDexie();
          if (snap && !cancelled) {
            useAppStore.setState({
              products: snap.products?.length ? snap.products : useAppStore.getState().products,
              sales: snap.sales || [],
              heldSales: snap.heldSales || [],
              credits: snap.credits || [],
              expenses: snap.expenses || [],
              suppliers: snap.suppliers || [],
              users: snap.users?.length ? snap.users : useAppStore.getState().users,
              stockReceives: snap.stockReceives || [],
              stockAudits: snap.stockAudits || [],
              activityLog: snap.activityLog || [],
              cart: snap.cart || [],
              ...(snap.settings ? { settings: snap.settings } : {}),
            });
          }
        } catch (e) {
          console.warn("[boot offline local]", e);
        }
      }

      if (cancelled) return;
      setDbReady(true);
    })();

    return () => {
      cancelled = true;
      unsubApp?.();
      unsubSync?.();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  useEffect(() => {
    if (!session) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "click", "scroll"] as const;
    const onActivity = () => resetIdle();
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    resetIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session, resetIdle]);

  // Always listen for focus/typing (including login)

  // Resume sync when online / tab visible / window focused (critical for phones)
  useEffect(() => {
    const sync = () => {
      void forceCloudSync({ silent: true });
    };
    const onOnline = () => {
      useSyncStore.getState().setOnline(true);
      sync();
    };
    const onOffline = () => useSyncStore.getState().setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!dbReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center">
          <div className="text-lg font-bold mb-2">Bar POS</div>
          <div className="text-sm text-slate-400">Loading…</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <InputFocusScroll />
        <LoginPage />
      </>
    );
  }

  const Page = PAGES[activeTab] || SellPage;

  return (
    <div className="h-[100dvh] w-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] touch-manipulation">
      <InputFocusScroll />
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 h-full overflow-y-auto md:overflow-hidden overscroll-y-contain pb-16 md:pb-0 [-webkit-overflow-scrolling:touch]">
          <Page />
        </main>
      </div>
    </div>
  );
}

export default App;
