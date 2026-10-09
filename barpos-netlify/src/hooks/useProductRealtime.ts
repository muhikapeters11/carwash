import { useEffect } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { useAppStore } from "@/stores/appStore";
import { isCloudReady } from "@/lib/supabase";
import { startProductRealtime, stopProductRealtime } from "@/lib/realtime";
import type { Product, Sale, User, Expense, Supplier } from "@/types";

/**
 * Live multi-device sync.
 * RULE: stock_quantity changes ONLY via products table (onProduct).
 * Sales / receives / audits / returns only update their own logs — never stock.
 * That prevents double +/- when both the event and product_upsert arrive.
 */
export function useProductRealtime() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const cloud = useSyncStore((s) => s.cloud);
  const setCloud = useSyncStore((s) => s.setCloud);

  useEffect(() => {
    if (!isOnline || !isCloudReady(cloud)) {
      stopProductRealtime();
      return;
    }

    const stop = startProductRealtime(cloud, {
      onProduct: (product, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            products: useAppStore
              .getState()
              .products.filter((p) => p.id !== product.id),
          });
          return;
        }
        const products = useAppStore.getState().products;
        const exists = products.find((p) => p.id === product.id);
        if (!exists) {
          useAppStore.setState({ products: [...products, product as Product] });
          return;
        }
        // Cloud product row is sole authority for stock + image
        const remoteImage =
          (product as Product).image_url || exists.image_url;
        const merged: Product = {
          ...exists,
          ...product,
          stock_quantity:
            product.stock_quantity !== undefined && product.stock_quantity !== null
              ? product.stock_quantity
              : exists.stock_quantity,
          cost: product.cost ?? exists.cost,
          image_url: remoteImage,
          name: product.name || exists.name,
          price: product.price ?? exists.price,
          updated_at: product.updated_at || exists.updated_at,
          units_per_pack: product.units_per_pack ?? exists.units_per_pack ?? 1,
          min_stock: product.min_stock ?? exists.min_stock ?? 0,
          is_active: product.is_active !== false,
        };
        useAppStore.setState({
          products: products.map((p) => (p.id === product.id ? merged : p)),
        });
      },

      onSale: (sale, event) => {
        if (event === "DELETE") return;
        const state = useAppStore.getState();
        const nextSales = state.sales.some((s) => s.id === sale.id)
          ? state.sales.map((s) => (s.id === sale.id ? (sale as Sale) : s))
          : [sale as Sale, ...state.sales].sort(
              (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
        useAppStore.setState({ sales: nextSales });
        // Credits derived from sales so Credits + Reports match every device
        void import("@/lib/sync/pullAll").then(({ rebuildCreditsFromSales }) => {
          useAppStore.setState({
            credits: rebuildCreditsFromSales(nextSales),
          });
        });
      },

      onUser: (user, event) => {
        if (event === "DELETE") {
          const state = useAppStore.getState();
          useAppStore.setState({
            users: state.users.filter((u) => u.id !== user.id),
          });
          if (state.session?.id === user.id) {
            state.logout();
          }
          return;
        }
        const state = useAppStore.getState();
        const users = state.users;
        const prev = users.find((u) => u.id === user.id);
        const mergedUser = {
          ...(prev || {}),
          ...user,
          is_active: user.is_active !== false,
          allowed_tabs: user.allowed_tabs || prev?.allowed_tabs || [],
        } as User;
        if (prev) {
          useAppStore.setState({
            users: users.map((u) => (u.id === user.id ? mergedUser : u)),
          });
        } else {
          useAppStore.setState({ users: [...users, mergedUser] });
        }
        const sess = useAppStore.getState().session;
        if (
          sess &&
          sess.id === user.id &&
          user.pin &&
          sess.pin_snapshot &&
          String(user.pin) !== String(sess.pin_snapshot)
        ) {
          useAppStore.getState().logout();
        }
        if (sess && sess.id === user.id && user.is_active === false) {
          useAppStore.getState().logout();
        }
      },

      onExpense: (row, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            expenses: useAppStore
              .getState()
              .expenses.filter((e) => e.id !== row.id),
          });
          return;
        }
        const list = useAppStore.getState().expenses;
        const exp = row as Expense;
        if (list.some((e) => e.id === exp.id)) {
          useAppStore.setState({
            expenses: list.map((e) => (e.id === exp.id ? exp : e)),
          });
        } else {
          useAppStore.setState({ expenses: [exp, ...list] });
        }
      },

      onSupplier: (row, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            suppliers: useAppStore
              .getState()
              .suppliers.filter((s) => s.id !== row.id),
          });
          return;
        }
        const list = useAppStore.getState().suppliers;
        const sup = row as Supplier;
        if (list.some((s) => s.id === sup.id)) {
          useAppStore.setState({
            suppliers: list.map((s) => (s.id === sup.id ? sup : s)),
          });
        } else {
          useAppStore.setState({ suppliers: [...list, sup] });
        }
      },

      onStockReceive: (row, event) => {
        if (event === "DELETE") return;
        const state = useAppStore.getState();
        const existing = state.stockReceives.find((r) => r.id === row.id);
        if (existing) {
          // e.g. mark-as-read on another admin device
          useAppStore.setState({
            stockReceives: state.stockReceives.map((r) =>
              r.id === row.id
                ? { ...r, ...row, seen_by_admin: !!(row as any).seen_by_admin || r.seen_by_admin }
                : r
            ),
          });
          return;
        }
        useAppStore.setState({
          stockReceives: [row as any, ...state.stockReceives],
        });
      },

      onStockAudit: (row, event) => {
        if (event === "DELETE") return;
        const id = String(row.id || "");
        if (!id) return;
        const state = useAppStore.getState();
        const existing = state.stockAudits.find((a) => a.id === id);
        if (existing) {
          useAppStore.setState({
            stockAudits: state.stockAudits.map((a) =>
              a.id === id
                ? { ...a, ...row, seen_by_admin: !!(row as any).seen_by_admin || a.seen_by_admin }
                : a
            ) as typeof state.stockAudits,
          });
          return;
        }
        const audit = {
          id,
          product_id: String(row.product_id || ""),
          product_name: String(row.product_name || ""),
          previous_qty: Number(row.previous_qty) || 0,
          new_qty: Number(row.new_qty) || 0,
          difference: Number(row.difference) || 0,
          audited_by: String(row.audited_by || ""),
          audited_by_name: String(row.audited_by_name || ""),
          note: row.note ? String(row.note) : undefined,
          created_at: String(row.created_at || new Date().toISOString()),
          seen_by_admin: !!row.seen_by_admin,
        };
        useAppStore.setState({
          stockAudits: [audit, ...state.stockAudits],
        });
      },

      onProductReturn: (row, event) => {
        if (event === "DELETE") return;
        const id = String(row.id || "");
        if (!id) return;
        const state = useAppStore.getState();
        if ((state.productReturns || []).some((r) => r.id === id)) return;
        // Log only — stock comes from onProduct
        useAppStore.setState({
          productReturns: [
            {
              id,
              product_id: String(row.product_id || ""),
              product_name: String(row.product_name || ""),
              quantity: Number(row.quantity) || 0,
              amount: Number(row.amount) || 0,
              note: (row.note as string) || undefined,
              cashier_id: String(row.cashier_id || ""),
              cashier_name: String(row.cashier_name || ""),
              created_at: String(row.created_at || new Date().toISOString()),
            },
            ...(state.productReturns || []),
          ],
        });
      },

      onStatus: (status, detail) => {
        if (status === "live") {
          setCloud({
            last_sync_error: undefined,
            last_sync_at: new Date().toISOString(),
          });
          void import("@/stores/syncStore").then(({ forceCloudSync }) => {
            void forceCloudSync({ silent: true });
          });
        } else if (status === "error") {
          setCloud({
            last_sync_error: `Live sync offline: ${detail || "error"}. Enable Realtime for tables in Supabase.`,
          });
        }
      },
    });

    // Periodic full pull so Reports/Credits/Dashboard stay aligned
    const reconnect = window.setInterval(() => {
      if (!navigator.onLine) return;
      void import("@/stores/syncStore").then(({ forceCloudSync }) => {
        void forceCloudSync({ silent: true });
      });
    }, 8_000); // fast monitor pull for multi-till

    return () => {
      window.clearInterval(reconnect);
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
