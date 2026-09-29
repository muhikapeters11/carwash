import { useEffect } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { useAppStore } from "@/stores/appStore";
import { isCloudReady } from "@/lib/supabase";
import { startProductRealtime, stopProductRealtime } from "@/lib/realtime";

/**
 * Live product stock/price updates from Supabase Realtime when cloud is on + online.
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
          useAppStore.getState().setProducts(products);
          return;
        }
        useAppStore.getState().mergeRemoteProduct(product);
      },
      onStatus: (status, detail) => {
        if (status === "live") {
          setCloud({ last_sync_error: undefined });
        } else if (status === "error") {
          setCloud({
            last_sync_error: `Realtime: ${detail || "connection error"} — enable table in Supabase Replication`,
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
