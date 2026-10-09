import { useEffect } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { useAppStore } from "@/stores/appStore";
import { isCloudReady } from "@/lib/supabase";
import { startProductRealtime, stopProductRealtime } from "@/lib/realtime";
import type { Product } from "@/types";

/**
 * Live shared data — sales + stock so Sell/Inventory match across devices
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
          const products = useAppStore.getState().products.map((p) =>
            p.id === product.id ? { ...p, is_active: false } : p
          );
          useAppStore.setState({ products });
          return;
        }
        // Cloud product row is source of truth for stock on other devices
        const products = useAppStore.getState().products;
        const exists = products.find((p) => p.id === product.id);
        if (!exists) {
          useAppStore.setState({ products: [...products, product] });
          return;
        }
        const lt = new Date(exists.updated_at || 0).getTime();
        const rt = new Date(product.updated_at || 0).getTime();
        // Prefer remote stock when remote is same age or newer (multi-device stock)
        const merged: Product =
          rt >= lt
            ? {
                ...exists,
                ...product,
                stock_quantity: product.stock_quantity,
                cost: product.cost ?? exists.cost,
                updated_at: product.updated_at || exists.updated_at,
                units_per_pack: product.units_per_pack ?? exists.units_per_pack ?? 1,
                min_stock: product.min_stock ?? exists.min_stock ?? 0,
              }
            : exists;
        useAppStore.setState({
          products: products.map((p) => (p.id === product.id ? merged : p)),
        });
      },

      onSale: (sale, event) => {
        if (event === "DELETE") return;
        const state = useAppStore.getState();
        const already = state.sales.some((s) => s.id === sale.id);

        if (already) {
          useAppStore.setState({
            sales: state.sales.map((s) => (s.id === sale.id ? sale : s)),
          });
          return;
        }

        // New sale from another device → add sale AND deduct stock on Sell/Inventory
        let products = state.products;
        // Deduct stock for any completed sale (cash/mpesa/card/credit)
        const items = Array.isArray(sale.items)
          ? sale.items
          : typeof sale.items === "string"
            ? (() => {
                try {
                  return JSON.parse(sale.items as unknown as string);
                } catch {
                  return [];
                }
              })()
            : [];
        if ((sale.status === "completed" || !sale.status) && items.length) {
          const now = new Date().toISOString();
          products = products.map((p) => {
            const line = items.find(
              (i: { product_id?: string; quantity?: number }) =>
                i.product_id === p.id
            );
            if (!line) return p;
            const qty = Number(line.quantity) || 0;
            if (qty <= 0) return p;
            return {
              ...p,
              stock_quantity: Math.max(0, (p.stock_quantity || 0) - qty),
              updated_at: now,
            };
          });
        }

        useAppStore.setState({
          sales: [sale, ...state.sales].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ),
          products,
        });
      },

      onUser: (user, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            users: useAppStore.getState().users.filter((u) => u.id !== user.id),
          });
          return;
        }
        const users = useAppStore.getState().users;
        if (users.some((u) => u.id === user.id)) {
          useAppStore.setState({
            users: users.map((u) => (u.id === user.id ? { ...u, ...user } : u)),
          });
        } else {
          useAppStore.setState({ users: [...users, user] });
        }
      },

      onExpense: (row, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            expenses: useAppStore.getState().expenses.filter((e) => e.id !== row.id),
          });
          return;
        }
        const list = useAppStore.getState().expenses;
        if (list.some((e) => e.id === row.id)) {
          useAppStore.setState({
            expenses: list.map((e) => (e.id === row.id ? row : e)),
          });
        } else {
          useAppStore.setState({ expenses: [row, ...list] });
        }
      },

      onSupplier: (row, event) => {
        if (event === "DELETE") {
          useAppStore.setState({
            suppliers: useAppStore.getState().suppliers.filter((s) => s.id !== row.id),
          });
          return;
        }
        const list = useAppStore.getState().suppliers;
        if (list.some((s) => s.id === row.id)) {
          useAppStore.setState({
            suppliers: list.map((s) => (s.id === row.id ? row : s)),
          });
        } else {
          useAppStore.setState({ suppliers: [...list, row] });
        }
      },

      onStockReceive: (row, event) => {
        if (event === "DELETE") return;
        const state = useAppStore.getState();
        if (state.stockReceives.some((r) => r.id === row.id)) return;

        // Another device received stock → add log + increase product qty
        const now = new Date().toISOString();
        const products = state.products.map((p) =>
          p.id === row.product_id
            ? {
                ...p,
                stock_quantity: p.stock_quantity + (row.quantity || 0),
                cost: row.unit_cost || p.cost,
                updated_at: now,
              }
            : p
        );

        useAppStore.setState({
          stockReceives: [row, ...state.stockReceives],
          products,
        });
      },

      onStockAudit: (row, event) => {
        if (event === "DELETE") return;
        const id = String(row.id || "");
        if (!id) return;
        const state = useAppStore.getState();
        if (state.stockAudits.some((a) => a.id === id)) return;

        const productId = String(row.product_id || "");
        const newQty = Number(row.new_qty) || 0;
        const now = new Date().toISOString();
        const products = state.products.map((p) =>
          p.id === productId
            ? { ...p, stock_quantity: newQty, updated_at: now }
            : p
        );
        const audit = {
          id,
          product_id: productId,
          product_name: String(row.product_name || ""),
          previous_qty: Number(row.previous_qty) || 0,
          new_qty: newQty,
          difference: Number(row.difference) || 0,
          audited_by: String(row.audited_by || ""),
          audited_by_name: String(row.audited_by_name || ""),
          note: (row.note as string) || undefined,
          created_at: String(row.created_at || now),
          seen_by_admin: !!row.seen_by_admin,
        };
        useAppStore.setState({
          stockAudits: [audit, ...state.stockAudits],
          products,
        });
      },

      onProductReturn: (row, event) => {
        if (event === "DELETE") return;
        const id = String(row.id || "");
        if (!id) return;
        const state = useAppStore.getState();
        if ((state.productReturns || []).some((r) => r.id === id)) return;

        const qty = Number(row.quantity) || 0;
        const productId = String(row.product_id || "");
        const now = new Date().toISOString();
        const products = state.products.map((p) =>
          p.id === productId
            ? {
                ...p,
                stock_quantity: p.stock_quantity + qty,
                updated_at: now,
              }
            : p
        );

        useAppStore.setState({
          productReturns: [
            {
              id,
              product_id: productId,
              product_name: String(row.product_name || ""),
              quantity: qty,
              amount: Number(row.amount) || 0,
              note: (row.note as string) || undefined,
              cashier_id: String(row.cashier_id || ""),
              cashier_name: String(row.cashier_name || ""),
              created_at: String(row.created_at || now),
            },
            ...(state.productReturns || []),
          ],
          products,
        });
      },

      onStatus: (status, detail) => {
        if (status === "live") {
          setCloud({ last_sync_error: undefined, last_sync_at: new Date().toISOString() });
          // Mandatory live path: pull latest snapshot when channel connects
          void import("@/stores/syncStore").then(({ forceCloudSync }) => {
            void forceCloudSync({ silent: true });
          });
        } else if (status === "error") {
          setCloud({
            last_sync_error:
              `Live sync offline: ${detail || "error"}. Enable Realtime for tables in Supabase (SQL in supabase/schema.sql).`,
          });
        }
      },
    });

    // Reconnect watchdog — phones drop websocket after idle; re-subscribe + resync
    const reconnect = window.setInterval(() => {
      if (!navigator.onLine) return;
      void import("@/stores/syncStore").then(({ forceCloudSync }) => {
        void forceCloudSync({ silent: true });
      });
    }, 30_000);

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
