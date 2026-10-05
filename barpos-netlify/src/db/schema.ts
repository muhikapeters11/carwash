/**
 * Bar POS – Dexie (IndexedDB) local database schema
 *
 * Offline source of truth for catalog, sales, queue, and settings.
 * Sync layer still pushes pending_ops → Supabase when online.
 */
import Dexie, { type Table } from "dexie";
import type {
  Product,
  Sale,
  Credit,
  Expense,
  Supplier,
  User,
  StockReceive,
  StockAudit,
  ActivityLog,
  AppSettings,
  CartItem,
} from "@/types";
import type { PendingOp } from "@/types/sync";

/** Held sale stored the same shape as Sale (status: held) */
export type HeldSale = Sale;

/** Key-value meta (device id, schema flags, etc.) */
export interface MetaRow {
  key: string;
  value: string;
}

/** Single-row settings document */
export interface SettingsRow extends AppSettings {
  id: "app";
}

/** Session is ephemeral – optional cache of last user id only */
export interface SessionCache {
  id: "session";
  user_id: string | null;
  updated_at: string;
}

export class BarPosDB extends Dexie {
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  heldSales!: Table<HeldSale, string>;
  credits!: Table<Credit, string>;
  expenses!: Table<Expense, string>;
  suppliers!: Table<Supplier, string>;
  users!: Table<User, string>;
  stockReceives!: Table<StockReceive, string>;
  stockAudits!: Table<StockAudit, string>;
  activityLog!: Table<ActivityLog, string>;
  pendingOps!: Table<PendingOp, string>;
  /** Current cart lines (cleared on complete sale) */
  cart!: Table<CartItem, string>;
  settings!: Table<SettingsRow, string>;
  meta!: Table<MetaRow, string>;
  session!: Table<SessionCache, string>;

  constructor() {
    super("barpos_local_v1");

    /**
     * v1 – initial schema
     * Indexed fields support POS queries: by category, date, sync status, SKU.
     */
    /**
     * v1 – initial schema (do not change — devices may still be on v1)
     */
    this.version(1).stores({
      products:
        "id, sku, name, category, is_active, stock_quantity, updated_at, [category+sku]",
      sales:
        "id, sale_number, created_at, cashier_id, payment_method, status, device_id, is_credit_payment",
      heldSales: "id, created_at, cashier_id, status",
      cart: "id, product_id",
      credits: "id, customer_name, balance, created_at, updated_at, sale_id",
      expenses: "id, created_at, recorded_by, amount",
      stockReceives: "id, product_id, created_at, received_by, seen_by_admin",
      stockAudits: "id, product_id, created_at, audited_by, seen_by_admin",
      suppliers: "id, name",
      users: "id, username, pin, role, is_active",
      activityLog: "id, created_at, user_id, action",
      pendingOps: "id, type, status, created_at, device_id, retries",
      settings: "id",
      meta: "key",
      session: "id",
    });

    /**
     * v2 – Strategy B: normalize row shapes + indexes for POS queries
     * Runs once on upgrade from v1 (or fresh install applies v1 then v2).
     */
    this.version(2)
      .stores({
        products:
          "id, sku, name, category, is_active, stock_quantity, updated_at, min_stock, [category+sku]",
        sales:
          "id, sale_number, created_at, cashier_id, payment_method, status, device_id, is_credit_payment",
        heldSales: "id, created_at, cashier_id, status",
        cart: "id, product_id",
        credits: "id, customer_name, balance, created_at, updated_at, sale_id",
        expenses: "id, created_at, recorded_by, amount",
        stockReceives: "id, product_id, created_at, received_by, seen_by_admin",
        stockAudits: "id, product_id, created_at, audited_by, seen_by_admin",
        suppliers: "id, name",
        users: "id, username, pin, role, is_active",
        activityLog: "id, created_at, user_id, action",
        pendingOps: "id, type, status, created_at, device_id, retries",
        settings: "id",
        meta: "key",
        session: "id",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();

        // Products: defaults for fields added after early demos
        await tx
          .table("products")
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (p.min_stock == null || Number.isNaN(Number(p.min_stock))) p.min_stock = 0;
            if (p.units_per_pack == null || Number(p.units_per_pack) < 1) p.units_per_pack = 1;
            if (p.is_active == null) p.is_active = true;
            if (p.stock_quantity == null) p.stock_quantity = 0;
            if (p.price == null) p.price = 0;
            if (p.cost == null) p.cost = 0;
            if (!p.updated_at) p.updated_at = now;
            if (!p.created_at) p.created_at = now;
            if (!p.sku) p.sku = "";
            if (!p.category) p.category = "other";
          });

        // Sales: ensure device_id / flags
        await tx
          .table("sales")
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.is_credit_payment == null) s.is_credit_payment = false;
            if (!s.status) s.status = "completed";
            if (!s.device_id) s.device_id = "local";
            if (s.change_given == null) s.change_given = 0;
            if (s.amount_paid == null) s.amount_paid = s.total ?? 0;
          });

        // Stock receives / audits: admin seen flag
        await tx
          .table("stockReceives")
          .toCollection()
          .modify((r: Record<string, unknown>) => {
            if (r.seen_by_admin == null) r.seen_by_admin = false;
          });
        await tx
          .table("stockAudits")
          .toCollection()
          .modify((a: Record<string, unknown>) => {
            if (a.seen_by_admin == null) a.seen_by_admin = false;
          });

        // Pending ops: retries + status for background sync
        await tx
          .table("pendingOps")
          .toCollection()
          .modify((o: Record<string, unknown>) => {
            if (o.retries == null) o.retries = 0;
            if (!o.status) o.status = "pending";
            if (!o.created_at) o.created_at = now;
          });

        // Users: active flag
        await tx
          .table("users")
          .toCollection()
          .modify((u: Record<string, unknown>) => {
            if (u.is_active == null) u.is_active = true;
          });

        // Mark upgrade in meta (same transaction if meta is available)
        try {
          await tx.table("meta").put({
            key: "dexie_upgrade_v2",
            value: now,
          });
        } catch {
          /* meta table always exists in this schema */
        }
      });
  }
}

/** Singleton DB instance */
export const db = new BarPosDB();

// ---------- helpers ----------

export async function metaGet(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function metaSet(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function getSettings(): Promise<SettingsRow | undefined> {
  return db.settings.get("app");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ id: "app", ...settings });
}

/** Pending ops still waiting to sync */
export async function listPendingOps(): Promise<PendingOp[]> {
  return db.pendingOps
    .where("status")
    .anyOf(["pending", "failed"])
    .sortBy("created_at");
}

export async function addPendingOp(op: PendingOp): Promise<void> {
  await db.pendingOps.put(op);
}

export async function markOpsSynced(ids: string[]): Promise<void> {
  await db.pendingOps.bulkDelete(ids);
}

/** Sales for a calendar day (local ISO date prefix YYYY-MM-DD) */
export async function salesOnDay(isoDay: string): Promise<Sale[]> {
  const start = `${isoDay}T00:00:00.000`;
  const end = `${isoDay}T23:59:59.999`;
  return db.sales.where("created_at").between(start, end, true, true).toArray();
}

/** Active products sorted like Sell screen: category then sku */
export async function activeProductsByCategory(): Promise<Product[]> {
  const all = await db.products.filter((p) => p.is_active !== false).toArray();
  const order = ["beer", "spirits", "soft_drinks", "wine", "cocktails", "food", "other"];
  return all.sort((a, b) => {
    const ca = order.indexOf(a.category);
    const cb = order.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    return (a.sku || "").localeCompare(b.sku || "", undefined, { numeric: true });
  });
}

export async function lowStockProducts(): Promise<Product[]> {
  return db.products
    .filter(
      (p) =>
        p.is_active !== false &&
        (p.min_stock ?? 0) > 0 &&
        p.stock_quantity <= (p.min_stock ?? 0)
    )
    .toArray();
}

/** Wipe all local business data (factory reset) – keeps schema */
export async function clearAllBusinessData(): Promise<void> {
  await Promise.all([
    db.products.clear(),
    db.sales.clear(),
    db.heldSales.clear(),
    db.credits.clear(),
    db.expenses.clear(),
    db.suppliers.clear(),
    db.users.clear(),
    db.stockReceives.clear(),
    db.stockAudits.clear(),
    db.activityLog.clear(),
    db.pendingOps.clear(),
    db.cart.clear(),
  ]);
}

/**
 * One-time import from Zustand/localStorage snapshot shapes.
 * Call after reading old persisted JSON if migrating.
 */
export async function importSnapshot(snapshot: {
  products?: Product[];
  sales?: Sale[];
  credits?: Credit[];
  expenses?: Expense[];
  suppliers?: Supplier[];
  users?: User[];
  stockReceives?: StockReceive[];
  stockAudits?: StockAudit[];
  activityLog?: ActivityLog[];
  pendingOps?: PendingOp[];
  heldSales?: Sale[];
  settings?: AppSettings;
}): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.products,
      db.sales,
      db.credits,
      db.expenses,
      db.suppliers,
      db.users,
      db.stockReceives,
      db.stockAudits,
      db.activityLog,
      db.pendingOps,
      db.heldSales,
      db.settings,
    ],
    async () => {
      if (snapshot.products?.length) await db.products.bulkPut(snapshot.products);
      if (snapshot.sales?.length) await db.sales.bulkPut(snapshot.sales);
      if (snapshot.credits?.length) await db.credits.bulkPut(snapshot.credits);
      if (snapshot.expenses?.length) await db.expenses.bulkPut(snapshot.expenses);
      if (snapshot.suppliers?.length) await db.suppliers.bulkPut(snapshot.suppliers);
      if (snapshot.users?.length) await db.users.bulkPut(snapshot.users);
      if (snapshot.stockReceives?.length)
        await db.stockReceives.bulkPut(snapshot.stockReceives);
      if (snapshot.stockAudits?.length) await db.stockAudits.bulkPut(snapshot.stockAudits);
      if (snapshot.activityLog?.length) await db.activityLog.bulkPut(snapshot.activityLog);
      if (snapshot.pendingOps?.length) await db.pendingOps.bulkPut(snapshot.pendingOps);
      if (snapshot.heldSales?.length) await db.heldSales.bulkPut(snapshot.heldSales);
      if (snapshot.settings) await saveSettings(snapshot.settings);
    }
  );
  await metaSet("migrated_from_zustand", new Date().toISOString());
}
