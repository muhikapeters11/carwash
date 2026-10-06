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
} from "@/types";
import { classifySyncError, humanSyncError, type SyncErrorKind } from "@/lib/sync/errors";

export type RemoteSnapshot = {
  products?: Product[];
  users?: User[];
  sales?: Sale[];
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

  const [products, users, sales, receives, audits, expenses, suppliers, settingsRow, creditEvents] =
    await Promise.all([
      getTable<Product>(cfg, "products", "select=*&order=updated_at.desc"),
      getTable<User>(cfg, "users", "select=*"),
      getTable<Sale>(cfg, "sales", "select=*&order=created_at.desc&limit=2000"),
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

  for (const r of [products, users, sales, receives, audits, expenses, suppliers, settingsRow, creditEvents]) {
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
    stockReceives: receives.data,
    stockAudits: audits.data,
    expenses: expenses.data,
    suppliers: suppliers.data,
    credits: creditEvents.data !== undefined ? Array.from(creditsById.values()) : undefined,
    settings: settingsRow.data?.[0]?.payload as Record<string, unknown> | undefined,
    errors,
  };
}

/** Apply remote snapshot into app store (local-first merge) */
export async function applyRemoteSnapshot(
  snap: RemoteSnapshot,
  getState: () => any,
  setState: (p: any) => void
) {
  const s = getState();

  // Merge cloud + local (LWW). Never wipe newer local changes on refresh/sync.
  // Other devices still get cloud rows; local pending wins until pushed.
  if (Array.isArray(snap.products)) {
    // Cloud catalog is the shared source of truth after push
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
    // After a successful cloud pull, Supabase is the shared source of truth.
    // Keep only truly local products that are still waiting in the sync queue.
    const pendingProductIds = new Set(
      (await import("@/stores/syncStore")).useSyncStore
        .getState()
        .pendingOps
        .filter((o: any) => o.type === "product_upsert" || o.type === "product_delete")
        .map((o: any) => String((o.payload as any)?.id || (o.payload as any)?.product_id || ""))
    );
    const mergedProducts = normalized.concat(
      (s.products || []).filter((p: any) => !normalized.some((r: any) => r.id === p.id) && pendingProductIds.has(p.id))
    );
    setState({ products: mergedProducts });
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
    setState({ users: normalized });
  }
  if (Array.isArray(snap.sales)) {
    const sales = [...snap.sales].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    setState({ sales });
  }
  if (Array.isArray(snap.stockReceives)) {
    setState({ stockReceives: snap.stockReceives });
  }
  if (Array.isArray(snap.stockAudits)) {
    setState({ stockAudits: snap.stockAudits });
  }
  if (Array.isArray(snap.credits)) {
    setState({ credits: snap.credits });
  }
  if (Array.isArray(snap.expenses)) {
    setState({ expenses: snap.expenses });
  }
  if (Array.isArray(snap.suppliers)) {
    setState({ suppliers: snap.suppliers });
  }
  if (snap.settings && typeof snap.settings === "object") {
    // Keep this device theme + printer preference
    setState({
      settings: {
        ...s.settings,
        ...snap.settings,
        till_number:
          (snap.settings as any).till_number ?? s.settings?.till_number ?? "",
        theme: s.settings?.theme ?? "light",
        preferred_printer: s.settings?.preferred_printer ?? "",
        auto_print_receipt: s.settings?.auto_print_receipt !== false,
      },
    });
  }
}
