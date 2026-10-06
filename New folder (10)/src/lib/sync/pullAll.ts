import type { CloudConfig } from "@/types/sync";
import { isCloudReady, supabaseRest } from "@/lib/supabase";
import type {
  Product,
  Sale,
  User,
  StockReceive,
  StockAudit,
  Expense,
  Supplier,
  Credit,
  ProductReturn,
} from "@/types";
import { classifySyncError, humanSyncError, type SyncErrorKind } from "@/lib/sync/errors";

export type RemoteSnapshot = {
  products?: Product[];
  users?: User[];
  sales?: Sale[];
  productReturns?: ProductReturn[];
  stockReceives?: StockReceive[];
  stockAudits?: StockAudit[];
  expenses?: Expense[];
  suppliers?: Supplier[];
  settings?: Record<string, unknown>;
  credits?: Credit[];
  errors: string[];
};

async function getTable<T>(
  cfg: CloudConfig,
  table: string,
  query = "select=*"
): Promise<{ data?: T[]; error?: string }> {
  const { data, error, status } = await supabaseRest<T[]>(cfg, table, { query });
  if (error) {
    const kind = classifySyncError(error, status);
    // missing table is ok until SQL applied
    if (kind === "permanent" && /does not exist|schema cache|404/i.test(error)) {
      return {};
    }
    return { error: humanSyncError(error, kind) };
  }
  return { data: data || [] };
}

function byIdMerge<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of remote) {
    if (!r?.id) continue;
    if (!map.has(r.id)) map.set(r.id, r);
    // existing: keep local if already present (append-only logs); remote fills gaps
  }
  return Array.from(map.values());
}

/** Pull entire business state relevant to multi-device */
export async function pullAllRemote(cfg: CloudConfig): Promise<RemoteSnapshot> {
  const errors: string[] = [];
  if (!isCloudReady(cfg)) {
    return { errors: ["Cloud not configured"] };
  }

  const [products, users, sales, returns, receives, audits, expenses, suppliers, settingsRow, creditEvents] =
    await Promise.all([
      getTable<Product>(cfg, "products", "select=*&order=updated_at.desc"),
      getTable<User>(cfg, "users", "select=*"),
      getTable<Sale>(cfg, "sales", "select=*&order=created_at.desc&limit=2000"),
      getTable<ProductReturn>(cfg, "product_returns", "select=*&order=created_at.desc&limit=2000"),
      getTable<StockReceive>(cfg, "stock_receives", "select=*&order=created_at.desc&limit=1000"),
      getTable<StockAudit>(cfg, "stock_audits", "select=*&order=created_at.desc&limit=1000"),
      getTable<Expense>(cfg, "expenses", "select=*&order=created_at.desc&limit=1000"),
      getTable<Supplier>(cfg, "suppliers", "select=*"),
      getTable<{ id: string; payload: Record<string, unknown> }>(
        cfg,
        "app_settings",
        "select=*&id=eq.app"
      ),
      getTable<{ id: string; payload: Record<string, unknown>; created_at?: string }>(
        cfg,
        "credit_events",
        "select=*&order=created_at.asc&limit=5000"
      ),
    ]);

  for (const r of [products, users, sales, returns, receives, audits, expenses, suppliers, settingsRow, creditEvents]) {
    if (r.error) errors.push(r.error);
  }

  // Credits are stored as immutable credit_events so every device can rebuild
  // the same current credit balance without requiring a separate credits table.
  const creditsById = new Map<string, Credit>();
  for (const event of creditEvents.data || []) {
    const payload = (event as any)?.payload || {};
    if (payload.type === "credit_open" && payload.credit?.id) {
      const c = payload.credit as Credit;
      creditsById.set(c.id, c);
    } else if (payload.type === "credit_pay" && payload.credit_id) {
      const current = creditsById.get(String(payload.credit_id));
      if (current) {
        const amount = Math.max(0, Number(payload.amount) || 0);
        const paidAt = String(payload.at || event.created_at || new Date().toISOString());
        const newPaid = Math.min(current.original_amount, current.amount_paid + amount);
        creditsById.set(current.id, {
          ...current,
          amount_paid: newPaid,
          balance: Math.max(0, current.original_amount - newPaid),
          updated_at: paidAt,
          fully_paid_at: newPaid >= current.original_amount ? (current.fully_paid_at || paidAt) : current.fully_paid_at,
          payments: [...(current.payments || []), { amount, method: payload.method, paid_at: paidAt, recorded_by: String(payload.recorded_by || payload.device_id || "system") }],
        });
      }
    }
  }

  return {
    products: products.data,
    users: users.data,
    sales: sales.data,
    productReturns: returns.data,
    stockReceives: receives.data,
    stockAudits: audits.data,
    expenses: expenses.data,
    suppliers: suppliers.data,
    credits: creditEvents.data !== undefined ? Array.from(creditsById.values()) : undefined,
    settings: settingsRow.data?.[0]?.payload as Record<string, unknown> | undefined,
    errors,
  };
}

/**
 * Apply remote data without replacing newer local/pending data.
 *
 * The old implementation replaced whole arrays after every pull. That created
 * a race: a sale/stock update could be in Zustand and queued locally while the
 * pull still returned the previous cloud snapshot, so a refresh immediately
 * restored the old values.  We now merge by id and explicitly preserve rows
 * that are still pending upload on this device.
 */
export async function applyRemoteSnapshot(
  snap: RemoteSnapshot,
  getState: () => any,
  setState: (p: any) => void
) {
  const s = getState();
  const { useSyncStore } = await import("@/stores/syncStore");
  const pending = useSyncStore.getState().pendingOps;

  const pendingFor = (types: string[]) =>
    new Set(
      pending
        .filter((o: any) => types.includes(o.type) && (o.status === "pending" || o.status === "failed"))
        .map((o: any) => String((o.payload as any)?.id || (o.payload as any)?.product_id || ""))
        .filter(Boolean)
    );

  const mergeRows = <T extends { id: string }>(
    local: T[] = [],
    remote: T[] = [],
    pendingIds = new Set<string>()
  ): T[] => {
    const map = new Map<string, T>();
    for (const row of remote) if (row?.id) map.set(row.id, row);
    for (const row of local) {
      if (!row?.id) continue;
      // Local wins while this exact record is waiting to upload.
      if (pendingIds.has(row.id) || !map.has(row.id)) map.set(row.id, row);
    }
    return Array.from(map.values());
  };

  if (Array.isArray(snap.products)) {
    const normalized = snap.products.map((rp: any) => ({
      units_per_pack: 1,
      min_stock: 0,
      is_active: true,
      created_at: rp.created_at || new Date().toISOString(),
      updated_at: rp.updated_at || new Date().toISOString(),
      sku: "",
      name: "",
      category: "soft_drinks",
      price: 0,
      cost: 0,
      stock_quantity: 0,
      ...rp,
    }));
    const pendingDeletes = pendingFor(["product_delete"]);
    const remoteProducts = normalized.filter((p: any) => !pendingDeletes.has(p.id));
    setState({
      products: mergeRows(
        s.products || [],
        remoteProducts,
        pendingFor(["product_upsert", "product_delete"])
      ).filter((p: any) => !pendingDeletes.has(p.id)),
    });
  }

  if (Array.isArray(snap.users)) {
    const normalized = snap.users
      .filter((u: any) => u?.id && u.is_active !== false)
      .map((u: any) => ({
        is_active: true,
        allowed_tabs: [],
        created_at: u.created_at || new Date().toISOString(),
        ...u,
      }));
    const users = mergeRows(
      s.users || [],
      normalized,
      pendingFor(["user_upsert", "user_delete"])
    );
    const byId = new Map(users.map((u: any) => [u.id, u]));
    if (!byId.has("u-admin")) {
      byId.set("u-admin", {
        id: "u-admin", full_name: "System Admin", username: "admin", role: "admin",
        pin: "1234", allowed_tabs: [], is_active: true, created_at: new Date().toISOString(),
      });
    }
    if (!byId.has("u-cashier")) {
      byId.set("u-cashier", {
        id: "u-cashier", full_name: "John Cashier", username: "cashier", role: "cashier",
        pin: "0000", allowed_tabs: ["dashboard", "sell", "inventory", "credits"],
        is_active: true, created_at: new Date().toISOString(),
      });
    }
    const pendingUserDeletes = pendingFor(["user_delete"]);
    setState({ users: Array.from(byId.values()).filter((u: any) => !pendingUserDeletes.has(u.id)) });
  }

  if (Array.isArray(snap.sales)) {
    setState({
      sales: mergeRows(s.sales || [], snap.sales, pendingFor(["sale"])).sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      ),
    });
  }
  if (Array.isArray(snap.productReturns)) {
    setState({ productReturns: mergeRows(s.productReturns || [], snap.productReturns, pendingFor(["product_return"])) });
  }
  if (Array.isArray(snap.stockReceives)) {
    setState({ stockReceives: mergeRows(s.stockReceives || [], snap.stockReceives, pendingFor(["stock_receive"])) });
  }
  if (Array.isArray(snap.stockAudits)) {
    setState({ stockAudits: mergeRows(s.stockAudits || [], snap.stockAudits, pendingFor(["stock_audit"])) });
  }
  if (Array.isArray(snap.expenses)) {
    const pendingExpenseDeletes = pendingFor(["expense_delete"]);
    setState({
      expenses: mergeRows(s.expenses || [], snap.expenses.filter((e: any) => !pendingExpenseDeletes.has(e.id)), pendingFor(["expense", "expense_delete"]))
        .filter((e: any) => !pendingExpenseDeletes.has(e.id)),
    });
  }
  if (Array.isArray(snap.suppliers)) {
    setState({ suppliers: mergeRows(s.suppliers || [], snap.suppliers, pendingFor(["supplier_upsert"])) });
  }
  if (Array.isArray(snap.credits)) {
    // Credit balances are rebuilt from immutable cloud events. Keep local
    // records that have a pending credit event until the next successful pull.
    setState({ credits: mergeRows(s.credits || [], snap.credits, pendingFor(["credit_payment"])) });
  }
  if (snap.settings && typeof snap.settings === "object") {
    const hasPendingSettings = pending.some((o: any) => o.type === "settings_upsert" && (o.status === "pending" || o.status === "failed"));
    if (!hasPendingSettings) {
      setState({
        settings: {
          ...s.settings,
          ...snap.settings,
          till_number: (snap.settings as any).till_number ?? s.settings?.till_number ?? "",
          theme: s.settings?.theme ?? "light",
          preferred_printer: s.settings?.preferred_printer ?? "",
          auto_print_receipt: s.settings?.auto_print_receipt !== false,
        },
      });
    }
  }
}
