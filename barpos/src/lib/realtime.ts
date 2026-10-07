/**
 * Multi-table Supabase Realtime for cross-device POS sync.
 * Subscribes to products, sales, stock, expenses, users, etc.
 */
import type { CloudConfig } from "@/types/sync";
import type {
  Product,
  Sale,
  StockReceive,
  StockAudit,
  Expense,
  User,
  ProductReturn,
  Supplier,
  AppTab,
  UserRole,
  ProductCategory,
  PaymentMethod,
  CartItem,
} from "@/types";
import { isCloudReady } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";

export type RealtimeStatus = "off" | "connecting" | "live" | "error";

export type RealtimeHandlers = {
  onProduct: (product: Product, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onSale: (sale: Sale, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onStockReceive: (row: StockReceive, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onStockAudit: (row: StockAudit, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onExpense: (row: Expense, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onUser: (row: User, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onProductReturn: (row: ProductReturn, event: "INSERT" | "UPDATE" | "DELETE") => void;
  onSupplier: (row: Supplier, event: "INSERT" | "UPDATE" | "DELETE") => void;
  /** Credit events are opaque; caller should refresh credits from cloud */
  onCreditEvent?: () => void;
  onStatus?: (status: RealtimeStatus, detail?: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let channel: any = null;
let lastUrl = "";
let lastKey = "";

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v);
}

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id: str(row.id),
    sku: str(row.sku),
    name: str(row.name),
    category: (row.category as ProductCategory) || "soft_drinks",
    price: num(row.price),
    cost: num(row.cost),
    stock_quantity: num(row.stock_quantity),
    units_per_pack: num(row.units_per_pack, 1) || 1,
    pack_label: row.pack_label ? str(row.pack_label) : undefined,
    min_stock: num(row.min_stock),
    image_url: row.image_url ? str(row.image_url) : undefined,
    is_active: row.is_active !== false,
    created_at: str(row.created_at, new Date().toISOString()),
    updated_at: str(row.updated_at, new Date().toISOString()),
  };
}

function rowToSale(row: Record<string, unknown>): Sale {
  const items = Array.isArray(row.items) ? (row.items as CartItem[]) : [];
  return {
    id: str(row.id),
    sale_number: str(row.sale_number),
    items,
    subtotal: num(row.subtotal),
    total: num(row.total),
    payment_method: (row.payment_method as PaymentMethod) || "cash",
    amount_paid: num(row.amount_paid),
    change_given: num(row.change_given),
    credit_customer_name: row.credit_customer_name
      ? str(row.credit_customer_name)
      : undefined,
    credit_id: row.credit_id ? str(row.credit_id) : undefined,
    cashier_id: str(row.cashier_id),
    cashier_name: str(row.cashier_name),
    status: (row.status as Sale["status"]) || "completed",
    is_credit_payment: Boolean(row.is_credit_payment),
    created_at: str(row.created_at, new Date().toISOString()),
    device_id: str(row.device_id, "remote"),
  };
}

function rowToStockReceive(row: Record<string, unknown>): StockReceive {
  return {
    id: str(row.id),
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    quantity: num(row.quantity),
    total_cost: num(row.total_cost),
    unit_cost: num(row.unit_cost),
    supplier_name: row.supplier_name ? str(row.supplier_name) : undefined,
    receipt_no: row.receipt_no ? str(row.receipt_no) : undefined,
    received_by: str(row.received_by),
    received_by_name: str(row.received_by_name),
    created_at: str(row.created_at, new Date().toISOString()),
    seen_by_admin: Boolean(row.seen_by_admin),
  };
}

function rowToStockAudit(row: Record<string, unknown>): StockAudit {
  return {
    id: str(row.id),
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    previous_qty: num(row.previous_qty),
    new_qty: num(row.new_qty),
    difference: num(row.difference),
    audited_by: str(row.audited_by),
    audited_by_name: str(row.audited_by_name),
    note: row.note ? str(row.note) : undefined,
    created_at: str(row.created_at, new Date().toISOString()),
    seen_by_admin: Boolean(row.seen_by_admin),
  };
}

function rowToExpense(row: Record<string, unknown>): Expense {
  return {
    id: str(row.id),
    description: str(row.description),
    amount: num(row.amount),
    category: row.category ? str(row.category) : undefined,
    recorded_by: str(row.recorded_by),
    recorded_by_name: str(row.recorded_by_name),
    created_at: str(row.created_at, new Date().toISOString()),
  };
}

function rowToUser(row: Record<string, unknown>): User {
  const tabs = Array.isArray(row.allowed_tabs)
    ? (row.allowed_tabs as AppTab[])
    : [];
  return {
    id: str(row.id),
    full_name: str(row.full_name),
    username: str(row.username),
    role: (row.role as UserRole) || "cashier",
    pin: str(row.pin),
    allowed_tabs: tabs,
    is_active: row.is_active !== false,
    created_at: str(row.created_at, new Date().toISOString()),
    updated_at: row.updated_at ? str(row.updated_at) : undefined,
  };
}

function rowToProductReturn(row: Record<string, unknown>): ProductReturn {
  return {
    id: str(row.id),
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    quantity: num(row.quantity),
    amount: num(row.amount),
    note: row.note ? str(row.note) : undefined,
    cashier_id: str(row.cashier_id),
    cashier_name: str(row.cashier_name),
    created_at: str(row.created_at, new Date().toISOString()),
  };
}

function rowToSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: str(row.id),
    name: str(row.name),
    phone: row.phone ? str(row.phone) : undefined,
    notes: row.notes ? str(row.notes) : undefined,
    created_at: str(row.created_at, new Date().toISOString()),
  };
}

type PgEvent = "INSERT" | "UPDATE" | "DELETE";

function bindTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ch: any,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRow: (row: Record<string, unknown>) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRow: (row: any, event: PgEvent) => void
) {
  ch = ch.on(
    "postgres_changes",
    { event: "*", schema: "public", table },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload: any) => {
      const event = payload.eventType as PgEvent;
      if (event === "DELETE" && payload.old) {
        const id = str(payload.old.id);
        if (!id) return;
        onRow({ id }, "DELETE");
        return;
      }
      const row = payload.new as Record<string, unknown> | null;
      if (!row?.id) return;
      onRow(mapRow(row), event);
    }
  );
  return ch;
}

/**
 * Live multi-table updates via Supabase Realtime.
 */
export function startCloudRealtime(
  cfg: CloudConfig,
  handlers: RealtimeHandlers
): () => void {
  if (!isCloudReady(cfg)) {
    handlers.onStatus?.("off", "Cloud not configured");
    return () => undefined;
  }

  let cancelled = false;
  const localDevice = getDeviceId();

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

      handlers.onStatus?.("connecting");

      if (channel) {
        try {
          await client.removeChannel(channel);
        } catch {
          /* ignore */
        }
        channel = null;
      }

      let ch = client.channel("barpos-multidevice");

      ch = bindTable(ch, "products", rowToProduct, handlers.onProduct);
      ch = bindTable(ch, "sales", rowToSale, (sale: Sale, event: PgEvent) => {
        // Skip echo of sales this device just wrote (still apply product stock via products channel)
        if (event !== "DELETE" && sale.device_id && sale.device_id === localDevice) {
          // Still merge in case another tab on same device — upsert by id is idempotent
        }
        handlers.onSale(sale, event);
      });
      ch = bindTable(ch, "stock_receives", rowToStockReceive, handlers.onStockReceive);
      ch = bindTable(ch, "stock_audits", rowToStockAudit, handlers.onStockAudit);
      ch = bindTable(ch, "expenses", rowToExpense, handlers.onExpense);
      ch = bindTable(ch, "users", rowToUser, handlers.onUser);
      ch = bindTable(ch, "product_returns", rowToProductReturn, handlers.onProductReturn);
      ch = bindTable(ch, "suppliers", rowToSupplier, handlers.onSupplier);

      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_events" },
        () => {
          handlers.onCreditEvent?.();
        }
      );

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
    stopCloudRealtime();
  };
}

/** @deprecated use startCloudRealtime */
export function startProductRealtime(
  cfg: CloudConfig,
  handlers: {
    onProduct: RealtimeHandlers["onProduct"];
    onStatus?: RealtimeHandlers["onStatus"];
  }
): () => void {
  return startCloudRealtime(cfg, {
    onProduct: handlers.onProduct,
    onSale: () => undefined,
    onStockReceive: () => undefined,
    onStockAudit: () => undefined,
    onExpense: () => undefined,
    onUser: () => undefined,
    onProductReturn: () => undefined,
    onSupplier: () => undefined,
    onStatus: handlers.onStatus,
  });
}

export function stopCloudRealtime() {
  if (channel && client) {
    try {
      void client.removeChannel(channel);
    } catch {
      /* ignore */
    }
    channel = null;
  }
}

/** @deprecated use stopCloudRealtime */
export function stopProductRealtime() {
  stopCloudRealtime();
}
