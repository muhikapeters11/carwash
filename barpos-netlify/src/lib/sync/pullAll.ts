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
  productReturns?: any[];
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

  const [products, users, sales, receives, audits, expenses, suppliers, productReturns, settingsRow] =
    await Promise.all([
      getTable<Product>(cfg, "products", "select=*&order=updated_at.desc"),
      getTable<User>(cfg, "users", "select=*"),
      getTable<Sale>(cfg, "sales", "select=*&order=created_at.desc&limit=2000"),
      getTable<StockReceive>(cfg, "stock_receives", "select=*&order=created_at.desc&limit=1000"),
      getTable<StockAudit>(cfg, "stock_audits", "select=*&order=created_at.desc&limit=1000"),
      getTable<Expense>(cfg, "expenses", "select=*&order=created_at.desc&limit=1000"),
      getTable<Supplier>(cfg, "suppliers", "select=*"),
      getTable<any>(cfg, "product_returns", "select=*&order=created_at.desc&limit=1000"),
      getTable<{ id: string; payload: Record<string, unknown> }>(
        cfg,
        "app_settings",
        "select=*&id=eq.app"
      ),
    ]);

  for (const r of [products, users, sales, receives, audits, expenses, suppliers, productReturns, settingsRow]) {
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
    productReturns: productReturns.data,
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

  // After system reset, do not re-import sales/expenses/etc for a short window
  let skipBusinessRestore = false;
  try {
    const resetAt = Number(localStorage.getItem("barpos-reset-at") || "0");
    if (resetAt && Date.now() - resetAt < 3 * 60 * 1000) {
      skipBusinessRestore = true;
    }
  } catch {
    /* ignore */
  }

  // Merge cloud + local (LWW). Never wipe newer local changes on refresh/sync.
  // Other devices still get cloud rows; local pending wins until pushed.
  if (snap.products?.length && !skipBusinessRestore) {
    // Merge LWW so a local stock receive is not wiped by an older cloud row
    const { mergeCatalogCloudFirst } = await import("@/lib/sync/merge");
    setState({
      products: mergeCatalogCloudFirst(s.products || [], snap.products),
    });
  }
  // Users: cloud list is authority when we successfully received an array from pull
  if (Array.isArray(snap.users)) {
    const { mergeUsersCloudFirst } = await import("@/lib/sync/merge");
    const normalized = snap.users
      .filter((u: any) => u?.id && u.is_active !== false)
      .map((u: any) => ({
        is_active: true,
        allowed_tabs: u.allowed_tabs || [],
        created_at: u.created_at || new Date().toISOString(),
        ...u,
      }));
    let merged =
      normalized.length > 0
        ? mergeUsersCloudFirst(s.users || [], normalized)
        : []; // cloud empty → drop stale local logins (deleted on main device)
    const hasAdmin = merged.some(
      (u: any) => u.role === "admin" && u.is_active !== false
    );
    if (!hasAdmin) {
      // Only inject default admin if cloud truly has no admin (first install / wipe)
      merged = [
        {
          id: "u-admin",
          full_name: "System Admin",
          username: "admin",
          role: "admin",
          pin: "1234",
          allowed_tabs: [],
          is_active: true,
          created_at: new Date().toISOString(),
        },
        ...merged,
      ];
    }
    setState({ users: merged });
  }

  if (skipBusinessRestore) {
    // After system reset: clear transactional history, but do NOT wipe products
    // the user may have just re-imported (that caused imports to "disappear").
    setState({
      sales: [],
      expenses: [],
      credits: [],
      productReturns: [],
      stockReceives: [],
      stockAudits: [],
      heldSales: [],
      activityLog: [],
    });
  } else if (Array.isArray(snap.sales)) {
    if (snap.sales.length) {
      const merged = byIdMerge(s.sales || [], snap.sales);
      merged.sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      setState({ sales: merged });
    } else {
      // Cloud empty after wipe — clear local history so reports/dashboard stay empty
      setState({ sales: [] });
    }
  }
  if (!skipBusinessRestore && snap.stockReceives?.length) {
    setState({
      stockReceives: byIdMerge(s.stockReceives || [], snap.stockReceives),
    });
  }
  if (!skipBusinessRestore && snap.stockAudits?.length) {
    setState({
      stockAudits: byIdMerge(s.stockAudits || [], snap.stockAudits),
    });
  }
  if (!skipBusinessRestore && Array.isArray(snap.expenses)) {
    if (snap.expenses.length) {
      const remoteIds = new Set(snap.expenses.map((e: any) => e.id));
      const localOnly = (s.expenses || []).filter((e: any) => {
        if (remoteIds.has(e.id)) return false;
        const age = Date.now() - new Date(e.created_at || 0).getTime();
        return age < 2 * 24 * 60 * 60 * 1000;
      });
      setState({ expenses: [...snap.expenses, ...localOnly] });
    } else {
      setState({ expenses: [] });
    }
  }
  if (!skipBusinessRestore && Array.isArray(snap.suppliers)) {
    if (snap.suppliers.length) {
      const remoteIds = new Set(snap.suppliers.map((x: any) => x.id));
      const localOnly = (s.suppliers || []).filter((x: any) => {
        if (remoteIds.has(x.id)) return false;
        const age = Date.now() - new Date(x.created_at || 0).getTime();
        return age < 2 * 24 * 60 * 60 * 1000;
      });
      setState({ suppliers: [...snap.suppliers, ...localOnly] });
    } else {
      setState({ suppliers: [] });
    }
  }
  if (!skipBusinessRestore && Array.isArray(snap.productReturns)) {
    if (snap.productReturns.length) {
      const remoteIds = new Set(snap.productReturns.map((x: any) => x.id));
      const localOnly = (s.productReturns || []).filter((x: any) => {
        if (remoteIds.has(x.id)) return false;
        const age = Date.now() - new Date(x.created_at || 0).getTime();
        return age < 2 * 24 * 60 * 60 * 1000;
      });
      const merged = [...snap.productReturns, ...localOnly];
      merged.sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      setState({ productReturns: merged });
    } else {
      setState({ productReturns: [] });
    }
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
