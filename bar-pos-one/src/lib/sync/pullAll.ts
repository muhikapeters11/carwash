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
import { mergeCatalog, mergeUsers } from "@/lib/sync/merge";

export type RemoteSnapshot = {
  products?: Product[];
  users?: User[];
  sales?: Sale[];
  stockReceives?: StockReceive[];
  stockAudits?: StockAudit[];
  expenses?: Expense[];
  suppliers?: Supplier[];
  settings?: Record<string, unknown>;
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

  const [products, users, sales, receives, audits, expenses, suppliers, settingsRow] =
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
    ]);

  for (const r of [products, users, sales, receives, audits, expenses, suppliers, settingsRow]) {
    if (r.error) errors.push(r.error);
  }

  return {
    products: products.data,
    users: users.data,
    sales: sales.data,
    stockReceives: receives.data,
    stockAudits: audits.data,
    expenses: expenses.data,
    suppliers: suppliers.data,
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

  if (snap.products?.length) {
    setState({ products: mergeCatalog(s.products || [], snap.products) });
  }
  if (snap.users?.length) {
    setState({ users: mergeUsers(s.users || [], snap.users) });
  }
  if (snap.sales?.length) {
    setState({ sales: byIdMerge(s.sales || [], snap.sales) });
  }
  if (snap.stockReceives?.length) {
    setState({
      stockReceives: byIdMerge(s.stockReceives || [], snap.stockReceives),
    });
  }
  if (snap.stockAudits?.length) {
    setState({
      stockAudits: byIdMerge(s.stockAudits || [], snap.stockAudits),
    });
  }
  if (snap.expenses?.length) {
    setState({ expenses: byIdMerge(s.expenses || [], snap.expenses) });
  }
  if (snap.suppliers?.length) {
    setState({ suppliers: byIdMerge(s.suppliers || [], snap.suppliers) });
  }
  if (snap.settings && typeof snap.settings === "object") {
    setState({
      settings: { ...s.settings, ...snap.settings, till_number: (snap.settings as any).till_number ?? s.settings?.till_number },
    });
  }
}
