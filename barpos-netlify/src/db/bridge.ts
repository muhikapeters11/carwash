/**
 * Bridge: Zustand (UI state) ↔ Dexie (IndexedDB local DB)
 * - On startup: load Dexie → Zustand (or migrate from localStorage once)
 * - On change: debounced write Zustand → Dexie
 */
import { db, metaGet, metaSet, importSnapshot, saveSettings } from "@/db/schema";
import { assertProduct, assertSale } from "@/lib/assert";
import type { AppSettings, Product, Sale, Credit, Expense, Supplier, User, StockReceive, StockAudit, ActivityLog, CartItem } from "@/types";
import type { PendingOp } from "@/types/sync";

export type AppSnapshot = {
  products: Product[];
  sales: Sale[];
  heldSales: Sale[];
  credits: Credit[];
  expenses: Expense[];
  suppliers: Supplier[];
  users: User[];
  stockReceives: StockReceive[];
  stockAudits: StockAudit[];
  activityLog: ActivityLog[];
  cart: CartItem[];
  settings: AppSettings;
  activeTab?: string;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

export function isDbReady() {
  return ready;
}

/** Load local DB into a plain snapshot for Zustand */
export async function loadSnapshotFromDexie(): Promise<AppSnapshot | null> {
  try {
    const count = await db.products.count();
    const salesCount = await db.sales.count();
    const usersCount = await db.users.count();
    if (count === 0 && salesCount === 0 && usersCount === 0) {
      return null;
    }

    const [
      products,
      sales,
      heldSales,
      credits,
      expenses,
      suppliers,
      users,
      stockReceives,
      stockAudits,
      activityLog,
      cart,
      settingsRow,
    ] = await Promise.all([
      db.products.toArray(),
      db.sales.orderBy("created_at").reverse().toArray(),
      db.heldSales.toArray(),
      db.credits.toArray(),
      db.expenses.toArray(),
      db.suppliers.toArray(),
      db.users.toArray(),
      db.stockReceives.toArray(),
      db.stockAudits.toArray(),
      db.activityLog.orderBy("created_at").reverse().limit(200).toArray(),
      db.cart.toArray(),
      db.settings.get("app"),
    ]);

    let settings: AppSettings | undefined;
    if (settingsRow) {
      const { id: _omit, ...rest } = settingsRow as AppSettings & { id: string };
      settings = rest as AppSettings;
    }

    return {
      products,
      sales,
      heldSales,
      credits,
      expenses,
      suppliers,
      users: users.length ? users : [],
      stockReceives,
      stockAudits,
      activityLog,
      cart,
      settings: settings as AppSettings,
    };
  } catch (e) {
    console.error("[Dexie] load failed", e);
    return null;
  }
}

/** Persist full business state to IndexedDB */
export async function saveSnapshotToDexie(snap: AppSnapshot): Promise<void> {
  try {
    await db.transaction(
      "rw",
      [
        db.products,
        db.sales,
        db.heldSales,
        db.credits,
        db.expenses,
        db.suppliers,
        db.users,
        db.stockReceives,
        db.stockAudits,
        db.activityLog,
        db.cart,
        db.settings,
      ],
      async () => {
        await db.products.clear();
        await db.sales.clear();
        await db.heldSales.clear();
        await db.credits.clear();
        await db.expenses.clear();
        await db.suppliers.clear();
        await db.users.clear();
        await db.stockReceives.clear();
        await db.stockAudits.clear();
        await db.activityLog.clear();
        await db.cart.clear();

        if (snap.products?.length) {
          const products = snap.products.map((p) => {
            try { return assertProduct(p); } catch { return p; }
          });
          await db.products.bulkPut(products);
        }
        if (snap.sales?.length) {
          const sales = snap.sales.slice(0, 5000).map((s) => {
            try { return assertSale(s); } catch { return s; }
          });
          await db.sales.bulkPut(sales);
        }
        if (snap.heldSales?.length) await db.heldSales.bulkPut(snap.heldSales);
        if (snap.credits?.length) await db.credits.bulkPut(snap.credits);
        if (snap.expenses?.length) await db.expenses.bulkPut(snap.expenses);
        if (snap.suppliers?.length) await db.suppliers.bulkPut(snap.suppliers);
        if (snap.users?.length) await db.users.bulkPut(snap.users);
        if (snap.stockReceives?.length) await db.stockReceives.bulkPut(snap.stockReceives);
        if (snap.stockAudits?.length) await db.stockAudits.bulkPut(snap.stockAudits);
        if (snap.activityLog?.length)
          await db.activityLog.bulkPut(snap.activityLog.slice(0, 200));
        if (snap.cart?.length) await db.cart.bulkPut(snap.cart);
        if (snap.settings) await saveSettings(snap.settings);
      }
    );
  } catch (e) {
    console.error("[Dexie] save failed", e);
  }
}

function snapshotFromZustand(state: {
  products: Product[];
  sales: Sale[];
  heldSales: Sale[];
  credits: Credit[];
  expenses: Expense[];
  suppliers: Supplier[];
  users: User[];
  stockReceives: StockReceive[];
  stockAudits: StockAudit[];
  activityLog: ActivityLog[];
  cart: CartItem[];
  settings: AppSettings;
}): AppSnapshot {
  return {
    products: state.products,
    sales: state.sales,
    heldSales: state.heldSales,
    credits: state.credits,
    expenses: state.expenses,
    suppliers: state.suppliers,
    users: state.users,
    stockReceives: state.stockReceives,
    stockAudits: state.stockAudits,
    activityLog: state.activityLog,
    cart: state.cart,
    settings: state.settings,
  };
}

/** Debounced save from live Zustand store */
export function scheduleDexieSave(state: Parameters<typeof snapshotFromZustand>[0]) {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveSnapshotToDexie(snapshotFromZustand(state));
  }, 250);
}

/** Try migrate old zustand localStorage key into Dexie once */
async function migrateFromLocalStorage(): Promise<AppSnapshot | null> {
  try {
    const raw = localStorage.getItem("barpos-v2");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    if (!state || !Array.isArray(state.products)) return null;

    await importSnapshot({
      products: state.products,
      sales: state.sales,
      credits: state.credits,
      expenses: state.expenses,
      suppliers: state.suppliers,
      users: state.users,
      stockReceives: state.stockReceives,
      stockAudits: state.stockAudits,
      activityLog: state.activityLog,
      heldSales: state.heldSales,
      settings: state.settings,
    });
    await metaSet("migrated_from_localstorage", new Date().toISOString());
    return loadSnapshotFromDexie();
  } catch (e) {
    console.warn("[Dexie] migration skipped", e);
    return null;
  }
}

export async function syncPendingOpsToDexie(ops: PendingOp[]) {
  try {
    await db.pendingOps.clear();
    if (ops.length) await db.pendingOps.bulkPut(ops);
  } catch (e) {
    console.warn("[Dexie] pending ops save", e);
  }
}

export async function loadPendingOpsFromDexie(): Promise<PendingOp[]> {
  try {
    return await db.pendingOps.toArray();
  } catch {
    return [];
  }
}

/**
 * Boot sequence: open DB → load or migrate → mark ready
 */
export async function bootstrapLocalDb(): Promise<AppSnapshot | null> {
  try {
    await db.open();
  } catch (e) {
    console.error("[Dexie] open failed", e);
    ready = true;
    return null;
  }

  let snap = await loadSnapshotFromDexie();
  if (!snap) {
    const migrated = await metaGet("migrated_from_localstorage");
    if (!migrated) {
      snap = await migrateFromLocalStorage();
    }
  }

  ready = true;
  return snap;
}
