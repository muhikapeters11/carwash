import { useEffect } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { useAppStore } from "@/stores/appStore";
import { isCloudReady } from "@/lib/supabase";
import { startProductRealtime, stopProductRealtime } from "@/lib/realtime";

/**
 * Live shared data from Supabase Realtime (products, sales, users, etc.)
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
        useAppStore.getState().mergeRemoteProduct(product);
      },
      onSale: (sale, event) => {
        if (event === "DELETE") return;
        const sales = useAppStore.getState().sales;
        if (sales.some((s) => s.id === sale.id)) {
          useAppStore.setState({
            sales: sales.map((s) => (s.id === sale.id ? sale : s)),
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
        const list = useAppStore.getState().stockReceives;
        if (list.some((r) => r.id === row.id)) return;
        useAppStore.setState({ stockReceives: [row, ...list] });
      },
      onProductReturn: (row, event) => {
        if (event === "DELETE") return;
        const id = String(row.id || "");
        if (!id) return;
        const list = useAppStore.getState().productReturns || [];
        if (list.some((r) => r.id === id)) return;
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
            ...list,
          ],
        });
      },
      onStatus: (status, detail) => {
        if (status === "live") {
          setCloud({ last_sync_error: undefined });
        } else if (status === "error") {
          setCloud({
            last_sync_error: `Live sync: ${detail || "error"} — enable Replication for tables in Supabase`,
          });
        }
      },
    });

    return () => {
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
