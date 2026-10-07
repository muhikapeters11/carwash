import type { CloudConfig } from "@/types/sync";
import type { Product, Sale, User, Expense, Supplier, StockReceive } from "@/types";
import { isCloudReady } from "@/lib/supabase";

export type RealtimeStatus = "off" | "connecting" | "live" | "error";

type Handlers = {
  onProduct: (product: Product, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onSale?: (sale: Sale, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onUser?: (user: User, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onExpense?: (row: Expense, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onSupplier?: (row: Supplier, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onStockReceive?: (row: StockReceive, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onProductReturn?: (row: Record<string, unknown>, event: "INSERT" | "UPDATE" | "DELETE") => void;
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

function rowToSale(row: Record<string, unknown>): Sale {
  return {
    id: String(row.id),
    sale_number: String(row.sale_number || ""),
    items: (row.items as Sale["items"]) || [],
    subtotal: Number(row.subtotal) || 0,
    total: Number(row.total) || 0,
    payment_method: (row.payment_method as Sale["payment_method"]) || "cash",
    amount_paid: Number(row.amount_paid) || 0,
    change_given: Number(row.change_given) || 0,
    credit_customer_name: (row.credit_customer_name as string) || undefined,
    credit_id: (row.credit_id as string) || undefined,
    cashier_id: String(row.cashier_id || ""),
    cashier_name: String(row.cashier_name || ""),
    status: (row.status as Sale["status"]) || "completed",
    is_credit_payment: !!row.is_credit_payment,
    created_at: String(row.created_at || new Date().toISOString()),
    device_id: String(row.device_id || ""),
  };
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    full_name: String(row.full_name || ""),
    username: String(row.username || ""),
    pin: String(row.pin || ""),
    role: (row.role as User["role"]) || "cashier",
    allowed_tabs: (row.allowed_tabs as User["allowed_tabs"]) || [],
    is_active: row.is_active !== false,
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

/**
 * Live updates: products, sales, users, expenses, suppliers, stock_receives, product_returns
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
          realtime: { params: { eventsPerSecond: 20 } },
        });
        lastUrl = url;
        lastKey = key;
      }

      if (channel) {
        try {
          await client.removeChannel(channel);
        } catch {
          /* ignore */
        }
        channel = null;
      }

      const tables = [
        "products",
        "sales",
        "users",
        "expenses",
        "suppliers",
        "stock_receives",
        "product_returns",
      ] as const;

      let ch = client.channel("barpos-live");
      for (const table of tables) {
        ch = ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const event = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
            const row = (event === "DELETE" ? payload.old : payload.new) as Record<
              string,
              unknown
            > | null;
            if (!row?.id && table !== "products") return;

            if (table === "products") {
              if (event === "DELETE" && payload.old) {
                handlers.onProduct(
                  {
                    id: String(payload.old.id),
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
              if (row) handlers.onProduct(rowToProduct(row), event);
            } else if (table === "sales" && handlers.onSale && row) {
              handlers.onSale(rowToSale(row), event);
            } else if (table === "users" && handlers.onUser && row) {
              handlers.onUser(rowToUser(row), event);
            } else if (table === "expenses" && handlers.onExpense && row) {
              handlers.onExpense(
                {
                  id: String(row.id),
                  description: String(row.description || ""),
                  amount: Number(row.amount) || 0,
                  category: (row.category as string) || undefined,
                  recorded_by: String(row.recorded_by || ""),
                  recorded_by_name: String(row.recorded_by_name || ""),
                  created_at: String(row.created_at || new Date().toISOString()),
                },
                event
              );
            } else if (table === "suppliers" && handlers.onSupplier && row) {
              handlers.onSupplier(
                {
                  id: String(row.id),
                  name: String(row.name || ""),
                  phone: (row.phone as string) || undefined,
                  email: (row.email as string) || undefined,
                  notes: (row.notes as string) || undefined,
                  created_at: String(row.created_at || new Date().toISOString()),
                },
                event
              );
            } else if (table === "stock_receives" && handlers.onStockReceive && row) {
              handlers.onStockReceive(
                {
                  id: String(row.id),
                  product_id: String(row.product_id || ""),
                  product_name: String(row.product_name || ""),
                  quantity: Number(row.quantity) || 0,
                  total_cost: Number(row.total_cost) || 0,
                  unit_cost: Number(row.unit_cost) || 0,
                  supplier_name: (row.supplier_name as string) || undefined,
                  receipt_no: (row.receipt_no as string) || undefined,
                  received_by: String(row.received_by || ""),
                  received_by_name: String(row.received_by_name || ""),
                  created_at: String(row.created_at || new Date().toISOString()),
                  seen_by_admin: !!row.seen_by_admin,
                },
                event
              );
            } else if (table === "product_returns" && handlers.onProductReturn && row) {
              handlers.onProductReturn(row, event);
            }
          }
        );
      }

      channel = ch.subscribe((status: string) => {
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
