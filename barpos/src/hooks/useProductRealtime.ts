import { useEffect, useRef } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { useAppStore } from "@/stores/appStore";
import { isCloudReady } from "@/lib/supabase";
import { startCloudRealtime, stopCloudRealtime } from "@/lib/realtime";
import type {
  Sale,
  StockReceive,
  StockAudit,
  Expense,
  User,
  ProductReturn,
  Supplier,
  Product,
} from "@/types";

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...list[i], ...row };
    return next;
  }
  return [row, ...list];
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}

/**
 * Live multi-device sync via Supabase Realtime:
 * products, sales, stock receives/audits, expenses, users, returns, suppliers.
 * Falls back to periodic pull (App.tsx) if realtime is unavailable.
 */
export function useProductRealtime() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const cloud = useSyncStore((s) => s.cloud);
  const setCloud = useSyncStore((s) => s.setCloud);
  const creditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOnline || !isCloudReady(cloud)) {
      stopCloudRealtime();
      return;
    }

    const pendingIds = () => {
      const ops = useSyncStore.getState().pendingOps;
      return new Set(
        ops
          .filter((o) => o.status === "pending" || o.status === "failed")
          .map((o) => {
            const p = o.payload as { id?: string };
            return p?.id ? String(p.id) : "";
          })
          .filter(Boolean)
      );
    };

    const stop = startCloudRealtime(cloud, {
      onProduct: (product: Product, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            products: useAppStore.getState().products.map((p) =>
              p.id === product.id ? { ...p, is_active: false } : p
            ),
          });
          return;
        }
        // Do not overwrite a product that is still waiting to upload from this device
        if (pendingIds().has(product.id)) return;
        useAppStore.getState().mergeRemoteProduct(product);
      },

      onSale: (sale: Sale, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            sales: removeById(useAppStore.getState().sales, sale.id),
          });
          return;
        }
        if (pendingIds().has(sale.id)) return;
        const sales = useAppStore.getState().sales;
        if (sales.some((s) => s.id === sale.id)) {
          useAppStore.setState({
            sales: sales.map((s) => (s.id === sale.id ? { ...s, ...sale } : s)),
          });
        } else {
          useAppStore.setState({
            sales: [sale, ...sales].sort(
              (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            ),
          });
        }
      },

      onStockReceive: (row: StockReceive, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            stockReceives: removeById(useAppStore.getState().stockReceives, row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        useAppStore.setState({
          stockReceives: upsertById(useAppStore.getState().stockReceives, row),
        });
      },

      onStockAudit: (row: StockAudit, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            stockAudits: removeById(useAppStore.getState().stockAudits, row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        useAppStore.setState({
          stockAudits: upsertById(useAppStore.getState().stockAudits, row),
        });
      },

      onExpense: (row: Expense, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            expenses: removeById(useAppStore.getState().expenses, row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        useAppStore.setState({
          expenses: upsertById(useAppStore.getState().expenses, row),
        });
      },

      onUser: (row: User, event) => {
        if (event === "DELETE") {
          // Keep default admin/cashier shells; soft-delete others
          if (row.id === "u-admin" || row.id === "u-cashier") return;
          useAppStore.setState({
            users: useAppStore.getState().users.filter((u) => u.id !== row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        const users = useAppStore.getState().users;
        const i = users.findIndex((u) => u.id === row.id);
        if (i >= 0) {
          useAppStore.setState({
            users: users.map((u) => (u.id === row.id ? { ...u, ...row } : u)),
          });
        } else if (row.is_active !== false) {
          useAppStore.setState({ users: [...users, row] });
        }
      },

      onProductReturn: (row: ProductReturn, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            productReturns: removeById(useAppStore.getState().productReturns, row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        useAppStore.setState({
          productReturns: upsertById(useAppStore.getState().productReturns, row),
        });
      },

      onSupplier: (row: Supplier, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            suppliers: removeById(useAppStore.getState().suppliers, row.id),
          });
          return;
        }
        if (pendingIds().has(row.id)) return;
        useAppStore.setState({
          suppliers: upsertById(useAppStore.getState().suppliers, row),
        });
      },

      onCreditEvent: () => {
        // Debounce full credit rebuild via sync pull
        if (creditTimer.current) clearTimeout(creditTimer.current);
        creditTimer.current = setTimeout(() => {
          const s = useSyncStore.getState();
          if (s.isOnline && isCloudReady(s.cloud) && !s.isSyncing) {
            void s.syncNow({ silent: true });
          }
        }, 400);
      },

      onStatus: (status, detail) => {
        if (status === "live") {
          setCloud({ last_sync_error: undefined });
        } else if (status === "error") {
          setCloud({
            last_sync_error: `Realtime: ${detail || "connection error"} — add tables to supabase_realtime publication (see schema.sql)`,
          });
        }
      },
    });

    return () => {
      if (creditTimer.current) clearTimeout(creditTimer.current);
      stop();
    };
  }, [
    isOnline,
    cloud.enabled,
    cloud.supabase_url,
    cloud.supabase_anon_key,
    setCloud,
  ]);
}
