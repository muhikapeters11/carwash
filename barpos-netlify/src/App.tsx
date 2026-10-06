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
import { useSyncStore } from "@/stores/syncStore";

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

      // 1) Load local cache (offline backup)
      try {
        const snap = await bootstrapLocalDb();
        if (cancelled) return;
        if (snap) {
          useAppStore.setState({
            products: snap.products?.length ? snap.products : useAppStore.getState().products,
            sales: snap.sales || [],
            heldSales: snap.heldSales || [],
            credits: snap.credits || [],
            expenses: snap.expenses || [],
            suppliers: snap.suppliers || [],
            users: snap.users?.length
              ? (() => {
                  const current = snap.users.filter((u) => u && u.is_active !== false);
                  const byId = new Map(current.map((u) => [u.id, u]));
                  const existing = useAppStore.getState().users;
                  for (const fallback of existing.filter((u) =>
                    (u.id === "u-admin" || u.id === "u-cashier") && u.is_active
                  )) {
                    if (!byId.has(fallback.id)) byId.set(fallback.id, fallback);
                  }
                  return Array.from(byId.values());
                })()
              : useAppStore.getState().users,
            stockReceives: snap.stockReceives || [],
            stockAudits: snap.stockAudits || [],
            activityLog: snap.activityLog || [],
            cart: snap.cart || [],
            ...(snap.settings ? { settings: snap.settings } : {}),
          });
        }
        const ops = await loadPendingOpsFromDexie();
        if (!cancelled && ops.length) {
          useSyncStore.setState({ pendingOps: ops });
        }
      } catch (e) {
        console.warn("[boot local]", e);
      }

      if (cancelled) return;

      unsubApp = useAppStore.subscribe((state) => {
        // Local DB always updated; debounced write
        scheduleDexieSave(state);
      });
      unsubSync = useSyncStore.subscribe((s) => {
        void syncPendingOpsToDexie(s.pendingOps);
      });

      // 2) ALWAYS load from cloud first when the device has internet
      const online = typeof navigator !== "undefined" && navigator.onLine;
      const cloud = useSyncStore.getState().cloud;
      const canCloud =
        online &&
        !!(cloud?.supabase_url && cloud?.supabase_anon_key);

      if (canCloud) {
        // Ensure enabled so sync runs
        if (!cloud.enabled) {
          useSyncStore.getState().setCloud({ enabled: true });
        }
        try {
          const result = await Promise.race([
            useSyncStore.getState().syncNow({ silent: true }),
            new Promise<{ ok: boolean; message: string }>((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: false,
                    message: "Cloud sync timed out — using last local copy",
                  }),
                20000
              )
            ),
          ]);
          console.info("[boot cloud]", result.message);
        } catch (e) {
          console.warn("[boot cloud]", e);
        }
      }

      if (cancelled) return;
      setDbReady(true);

      // 3) Keep every device aligned with the latest successful cloud sync.
      // Polling is intentionally used in addition to product realtime because
      // sales, stock receives, audits, credits, expenses, suppliers and users
      // must all converge across separate computers.
      let sharedSyncTimer: number | undefined;
      if (canCloud) {
        sharedSyncTimer = window.setInterval(() => {
          const s = useSyncStore.getState();
          if (navigator.onLine && !s.isSyncing) {
            void s.syncNow({ silent: true });
          }
        }, 5000);

        const syncWhenVisible = () => {
          if (document.visibilityState === "visible" && navigator.onLine) {
            const s = useSyncStore.getState();
            if (!s.isSyncing) void s.syncNow({ silent: true });
          }
        };
        document.addEventListener("visibilitychange", syncWhenVisible);
        window.addEventListener("focus", syncWhenVisible);
        window.addEventListener("pageshow", syncWhenVisible);

        // Store cleanup on the effect scope.
        (window as any).__barposSharedSyncCleanup = () => {
          if (sharedSyncTimer) window.clearInterval(sharedSyncTimer);
          document.removeEventListener("visibilitychange", syncWhenVisible);
          window.removeEventListener("focus", syncWhenVisible);
          window.removeEventListener("pageshow", syncWhenVisible);
        };
      }
    })();

    return () => {
      cancelled = true;
      unsubApp?.();
      unsubSync?.();
      (window as any).__barposSharedSyncCleanup?.();
      delete (window as any).__barposSharedSyncCleanup;
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

  // When device comes online or tab focuses — pull shared cloud DB
  useEffect(() => {
    const sync = () => {
      const s = useSyncStore.getState();
      if (s.isOnline && s.cloud?.enabled && !s.isSyncing) {
        void s.syncNow({ silent: true });
      }
    };
    const onOnline = () => {
      useSyncStore.getState().setOnline(true);
      sync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", () => useSyncStore.getState().setOnline(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sync();
    });
    return () => {
      window.removeEventListener("online", onOnline);
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
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] touch-manipulation">
      <InputFocusScroll />
      <OfflineBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 h-full overflow-hidden [contain:layout_paint]">
          <Page />
        </main>
      </div>
    </div>
  );
}

export default App;
