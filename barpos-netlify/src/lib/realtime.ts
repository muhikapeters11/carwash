import type { CloudConfig } from "@/types/sync";
import type { Product } from "@/types";
import { isCloudReady } from "@/lib/supabase";

export type RealtimeStatus = "off" | "connecting" | "live" | "error";

type Handlers = {
  onProduct: (product: Product, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onStatus?: (status: RealtimeStatus, detail?: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let channel: any = null;
let lastUrl = "";
let lastKey = "";

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    name: String(row.name ?? ""),
    category: (row.category as Product["category"]) || "soft_drinks",
    price: Number(row.price) || 0,
    cost: Number(row.cost) || 0,
    stock_quantity: Number(row.stock_quantity) || 0,
    units_per_pack: Number(row.units_per_pack) || 1,
    pack_label: (row.pack_label as string) || undefined,
    min_stock: Number(row.min_stock) || 0,
    image_url: (row.image_url as string) || undefined,
    is_active: row.is_active !== false,
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

/**
 * Live product updates via Supabase Realtime.
 * Uses dynamic import so the app still starts if @supabase/supabase-js is not installed yet.
 */
export function startProductRealtime(cfg: CloudConfig, handlers: Handlers): () => void {
  if (!isCloudReady(cfg)) {
    handlers.onStatus?.("off", "Cloud not configured");
    return () => undefined;
  }

  let cancelled = false;

  void (async () => {
    try {
      const mod = await import("@supabase/supabase-js");
      if (cancelled) return;

      const url = cfg.supabase_url.trim();
      const key = cfg.supabase_anon_key.trim();

      if (!client || lastUrl !== url || lastKey !== key) {
        if (channel && client) {
          try {
            await client.removeChannel(channel);
          } catch {
            /* ignore */
          }
          channel = null;
        }
        client = mod.createClient(url, key, {
          realtime: { params: { eventsPerSecond: 10 } },
        });
        lastUrl = url;
        lastKey = key;
      }

      handlers.onStatus?.("connecting");

      if (channel) {
        try {
          await client.removeChannel(channel);
        } catch {
          /* ignore */
        }
        channel = null;
      }

      channel = client
        .channel("barpos-products")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "products" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const event = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
            if (event === "DELETE" && payload.old) {
              const id = String(payload.old.id || "");
              if (!id) return;
              handlers.onProduct(
                {
                  id,
                  sku: "",
                  name: "",
                  category: "soft_drinks",
                  price: 0,
                  cost: 0,
                  stock_quantity: 0,
                  units_per_pack: 1,
                  min_stock: 0,
                  is_active: false,
                  created_at: "",
                  updated_at: new Date().toISOString(),
                },
                "DELETE"
              );
              return;
            }
            const row = payload.new as Record<string, unknown> | null;
            if (!row?.id) return;
            handlers.onProduct(rowToProduct(row), event);
          }
        )
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") handlers.onStatus?.("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            handlers.onStatus?.("error", status);
          else if (status === "CLOSED") handlers.onStatus?.("off");
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Realtime unavailable";
      handlers.onStatus?.(
        "error",
        msg.includes("Failed to fetch") || msg.includes("Cannot find")
          ? "Run: npm install @supabase/supabase-js"
          : msg
      );
    }
  })();

  return () => {
    cancelled = true;
    stopProductRealtime();
  };
}

export function stopProductRealtime() {
  if (channel && client) {
    try {
      void client.removeChannel(channel);
    } catch {
      /* ignore */
    }
    channel = null;
  }
}
