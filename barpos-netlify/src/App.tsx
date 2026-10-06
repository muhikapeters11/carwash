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
      // 1) LOCAL FIRST — app must work offline with zero network wait
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
            users: snap.users?.length ? snap.users : useAppStore.getState().users,
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
      // UI ready immediately from local data (works with no internet)
      setDbReady(true);

      unsubApp = useAppStore.subscribe((state) => {
        scheduleDexieSave(state);
      });
      unsubSync = useSyncStore.subscribe((s) => {
        void syncPendingOpsToDexie(s.pendingOps);
      });

      // 2) CLOUD in background only — never blocks login/sell
      if (typeof navigator !== "undefined" && navigator.onLine) {
        void (async () => {
          try {
            const sync = useSyncStore.getState();
            if (!sync.cloud?.enabled) return;
            // Only push pending queue + pull remote (no bulk re-upload every boot)
            const result = await useSyncStore.getState().syncNow({ silent: true });
            console.info("[boot cloud bg]", result.message);
          } catch (e) {
            console.warn("[boot cloud bg]", e);
          }
        })();
      }
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
  if (!dbReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center">
          <div className="text-lg font-bold mb-2">Bar POS</div>
          <div className="text-sm text-slate-400">Loading local database…</div>
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
