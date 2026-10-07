import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProductReturn, 
  Product, Sale, Credit, Expense, Supplier, User, ActivityLog,
  AppSettings, SessionUser, CartItem, PaymentMethod, StockReceive, StockAudit, AppTab,
} from "@/types";
import { ALL_TABS } from "@/types";
import { uid, generateSaleNumber, isInCurrentBusinessDay, isInPreviousBusinessDay } from "@/lib/utils";
import { flushDexieSave } from "@/db/bridge";
import { getDeviceId } from "@/lib/device";
import { enqueueSync } from "@/stores/syncStore";
import { writeSaleTransaction } from "@/db/writeSale";

const DEFAULT_ADMIN: User = {
  id: "u-admin",
  full_name: "System Admin",
  username: "admin",
  role: "admin",
  pin: "1234",
  allowed_tabs: [...ALL_TABS],
  is_active: true,
  created_at: new Date().toISOString(),
};

const DEFAULT_CASHIER: User = {
  id: "u-cashier",
  full_name: "John Cashier",
  username: "cashier",
  role: "cashier",
  pin: "0000",
  allowed_tabs: ["dashboard", "sell", "inventory", "credits"],
  is_active: true,
  created_at: new Date().toISOString(),
};

const DEFAULT_SETTINGS: AppSettings = {
  business_name: "My Bar",
  business_phone: "",
  business_address: "",
  business_location: "",
  receipt_footer: "Thank you for your business!",
  thermal_width_mm: 80,
  currency_symbol: "KSh",
  date_format: "dd/MM/yyyy",
  theme: "light",
  logo_url: undefined,
  till_number: "",
  admin_recovery_code: "",
  device_mode: "till",
  preferred_printer: "",
  auto_print_receipt: false,
};

interface AppState {
  // Auth
  session: SessionUser | null;
  users: User[];
  login: (pin: string) => boolean;
  deleteUser: (id: string) => void;
  resetAdminPin: (recoveryCode: string, newPin: string) => { ok: boolean; message: string };
  logout: () => void;

  // Navigation
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Catalog
  products: Product[];
  setProducts: (p: Product[]) => void;
  addProduct: (p: Omit<Product, "id" | "created_at" | "updated_at">) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  /** Apply server/realtime product without re-queueing sync */
  mergeRemoteProduct: (product: Product) => void;

  // Cart / Sell
  cart: CartItem[];
  heldSales: Sale[];
  addToCart: (product: Product) => void;
  updateCartQty: (itemId: string, qty: number) => void;
  clearCart: () => void;
  holdSale: () => void;
  loadHeldSale: (id: string) => void;
  completeSale: (method: PaymentMethod, opts?: { creditCustomerName?: string; cashReceived?: number }) => Sale | null;

  // Sales history
  sales: Sale[];

  // Credits
  credits: Credit[];
  payCredit: (creditId: string, amount: number, method: PaymentMethod) => void;

  // Expenses
  expenses: Expense[];
  addExpense: (description: string, amount: number, category?: string) => void;
  deleteExpense: (id: string) => void;
  returnProducts: (items: { product_id: string; product_name: string; quantity: number; unit_price: number }[], note?: string) => void;

  // Suppliers
  suppliers: Supplier[];
  addSupplier: (s: Omit<Supplier, "id" | "created_at">) => void;
  deleteSupplier: (id: string) => void;

  // Stock
  stockReceives: StockReceive[];
  stockAudits: StockAudit[];
  receiveStock: (productId: string, quantity: number, totalCost: number, supplierName?: string, receiptNo?: string) => void;
  auditStock: (productId: string, newQty: number, note?: string) => void;
  markAuditsSeen: () => void;
  markReceivesSeen: () => void;

  // Activity
  activityLog: ActivityLog[];
  logActivity: (action: string, details?: string) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Wipe local + cloud (products, sales, everything). Returns result. */
  resetSystem: () => Promise<{ ok: boolean; message: string }>;

  // Helpers for dashboard
  getTodaySales: (cashierId?: string) => Sale[];
  getYesterdaySales: () => Sale[];
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      session: null,
      users: [DEFAULT_ADMIN, DEFAULT_CASHIER],
      activeTab: "sell",
      products: [], // empty until cloud/local data — avoids phone showing sample catalog
      cart: [],
      heldSales: [],
      sales: [],
      credits: [],
      productReturns: [],
      expenses: [],
      suppliers: [],
      stockReceives: [],
      stockAudits: [],
      activityLog: [],
      settings: DEFAULT_SETTINGS,

      login: (pin) => {
        let users = [...(get().users || [])];
        // Ensure at least one admin exists (do NOT overwrite an existing admin PIN)
        let admin = users.find((u) => u.role === "admin" && u.is_active !== false);
        if (!admin) {
          admin = {
            ...DEFAULT_ADMIN,
            id: "u-admin",
            pin: "1234",
            allowed_tabs: [...ALL_TABS],
            is_active: true,
          };
          users = [admin, ...users];
          set({ users });
          enqueueSync("user_upsert", admin);
        }

        const user = users.find((u) => u.pin === pin && u.is_active !== false);
        if (!user) return false;
        const session: SessionUser = {
          id: user.id,
          full_name: user.full_name,
          role: user.role,
          allowed_tabs: user.role === "admin" ? [...ALL_TABS] : user.allowed_tabs,
        };
        set({ session, activeTab: session.allowed_tabs[0] || "sell" });
        return true;
      },

      deleteUser: (id) => {
        const session = get().session;
        if (!session || session.role !== "admin") return;
        if (id === session.id) return; // cannot delete self
        set({ users: get().users.filter((u) => u.id !== id) });
        get().logActivity("User removed", id);
        enqueueSync("user_delete", { id });
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const s = useSyncStore.getState();
          if (s.isOnline) void s.syncNow({ silent: true });
        });
      },

      resetAdminPin: (recoveryCode, newPin) => {
        const code = (recoveryCode || "").trim();
        const pin = (newPin || "").replace(/\D/g, "");
        const saved = (get().settings.admin_recovery_code || "").trim();
        if (!saved) {
          return {
            ok: false,
            message: "No recovery code set. Log in on a device that still works and set one in Settings.",
          };
        }
        if (code !== saved) {
          return { ok: false, message: "Wrong recovery code" };
        }
        if (pin.length < 4) {
          return { ok: false, message: "New PIN must be at least 4 digits" };
        }
        const taken = get().users.some(
          (u) => u.role !== "admin" && u.pin === pin && u.is_active !== false
        );
        if (taken) {
          return { ok: false, message: "That PIN is used by another user" };
        }
        const admins = get().users.filter((u) => u.role === "admin" && u.is_active !== false);
        if (!admins.length) {
          return { ok: false, message: "No admin user found" };
        }
        const now = new Date().toISOString();
        const users = get().users.map((u) =>
          u.role === "admin" && u.is_active !== false
            ? { ...u, pin, updated_at: now }
            : u
        );
        set({ users });
        for (const u of users.filter((x) => x.role === "admin")) {
          enqueueSync("user_upsert", u);
        }
        get().logActivity("Admin PIN reset", "via recovery code");
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const s = useSyncStore.getState();
          if (s.isOnline) void s.syncNow({ silent: true });
        });
        return { ok: true, message: "Admin PIN updated. You can log in now." };
      },

      logout: () => {
        const s = get().session;
                set({ session: null, cart: [] });
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      setProducts: (p) => {
        set({ products: p });
        // Any bulk product change (import, etc.) must hit cloud too
        for (const prod of p) {
          enqueueSync("product_upsert", prod);
        }
      },

      addProduct: (p) => {
        const now = new Date().toISOString();
        const product: Product = { units_per_pack: 1, min_stock: 0, ...p, id: uid(), created_at: now, updated_at: now };
        set({ products: [...get().products, product] });
        get().logActivity("Product added", product.name);
        enqueueSync("product_upsert", product);
      },

      updateProduct: (id, patch) => {
        set({
          products: get().products.map((p) =>
            p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p
          ),
        });
        const prod = get().products.find((p) => p.id === id);
        if (prod) enqueueSync("product_upsert", prod);
      },

      deleteProduct: (id) => {
        const prod = get().products.find((p) => p.id === id);
        set({ products: get().products.filter((p) => p.id !== id) });
        if (prod) get().logActivity("Product deleted", prod.name);
        enqueueSync("product_delete", { id });
      },

      mergeRemoteProduct: (product) => {
        const normalized: Product = {
          units_per_pack: 1,
          min_stock: 0,
          is_active: true,
          created_at: product.created_at || new Date().toISOString(),
          updated_at: product.updated_at || new Date().toISOString(),
          ...product,
        };
        const exists = get().products.find((p) => p.id === normalized.id);
        if (exists) {
          // Do not let stale cloud/realtime wipe a local receive/sale
          const lt = new Date(exists.updated_at || 0).getTime();
          const rt = new Date(normalized.updated_at || 0).getTime();
          const merged =
            lt >= rt
              ? {
                  ...normalized,
                  ...exists,
                  stock_quantity: exists.stock_quantity,
                  cost: exists.cost,
                  updated_at: exists.updated_at,
                }
              : {
                  ...exists,
                  ...normalized,
                  units_per_pack: normalized.units_per_pack ?? exists.units_per_pack ?? 1,
                  min_stock: normalized.min_stock ?? exists.min_stock ?? 0,
                };
          set({
            products: get().products.map((p) =>
              p.id === normalized.id ? merged : p
            ),
          });
        } else {
          set({ products: [...get().products, normalized] });
        }
      },

      addToCart: (product) => {
        if (product.stock_quantity <= 0) return;
        const { cart } = get();
        const existing = cart.find((c) => c.product_id === product.id);
        if (existing) {
          if (existing.quantity >= product.stock_quantity) return;
          set({
            cart: cart.map((c) =>
              c.id === existing.id
                ? { ...c, quantity: c.quantity + 1, line_total: (c.quantity + 1) * c.unit_price }
                : c
            ),
          });
        } else {
          set({
            cart: [
              ...cart,
              {
                id: uid(),
                product_id: product.id,
                product_name: product.name,
                sku: product.sku,
                quantity: 1,
                unit_price: product.price,
                line_total: product.price,
              },
            ],
          });
        }
      },

      updateCartQty: (itemId, qty) => {
        if (qty <= 0) {
          set({ cart: get().cart.filter((c) => c.id !== itemId) });
          return;
        }
        set({
          cart: get().cart.map((c) =>
            c.id === itemId ? { ...c, quantity: qty, line_total: qty * c.unit_price } : c
          ),
        });
      },

      clearCart: () => set({ cart: [] }),

      holdSale: () => {
        const { cart, session, heldSales } = get();
        if (!cart.length || !session) return;
        const total = cart.reduce((s, i) => s + i.line_total, 0);
        const sale: Sale = {
          id: uid(),
          sale_number: generateSaleNumber(get().sales),
          items: cart,
          subtotal: total,
          total,
          payment_method: "cash",
          amount_paid: 0,
          change_given: 0,
          cashier_id: session.id,
          cashier_name: session.full_name,
          status: "held",
          created_at: new Date().toISOString(),
          device_id: getDeviceId(),
        };
        set({ heldSales: [...heldSales, sale], cart: [] });
        get().logActivity("Sale held", sale.sale_number);
      },

      loadHeldSale: (id) => {
        const held = get().heldSales.find((h) => h.id === id);
        if (!held) return;
        set({
          cart: held.items,
          heldSales: get().heldSales.filter((h) => h.id !== id),
        });
      },

      completeSale: (method, opts) => {
        const { cart, session, products } = get();
        if (!cart.length || !session) return null;

        const total = cart.reduce((s, i) => s + i.line_total, 0);
        const cashReceived = opts?.cashReceived ?? total;
        const change = method === "cash" ? Math.max(0, cashReceived - total) : 0;

        let creditId: string | undefined;
        if (method === "credit") {
          const cname = (opts?.creditCustomerName || "Unknown").trim();
          const key = cname.toLowerCase();
          const existing = get().credits.find(
            (c) => c.balance > 0 && c.customer_name.trim().toLowerCase() === key
          );
          if (existing) {
            creditId = existing.id;
            set({
              credits: get().credits.map((c) =>
                c.id === existing.id
                  ? {
                      ...c,
                      original_amount: c.original_amount + total,
                      balance: c.balance + total,
                      updated_at: new Date().toISOString(),
                    }
                  : c
              ),
            });
          } else {
            creditId = uid();
            const credit: Credit = {
              id: creditId,
              sale_id: "",
              customer_name: cname,
              original_amount: total,
              amount_paid: 0,
              balance: total,
              cashier_id: session.id,
              cashier_name: session.full_name,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              payments: [],
            };
            set({ credits: [...get().credits, credit] });
          }
        }

        const sale: Sale = {
          id: uid(),
          sale_number: generateSaleNumber(get().sales),
          items: [...cart],
          subtotal: total,
          total,
          payment_method: method,
          amount_paid: method === "credit" ? 0 : total,
          change_given: change,
          credit_customer_name: opts?.creditCustomerName,
          credit_id: creditId,
          cashier_id: session.id,
          cashier_name: session.full_name,
          status: "completed",
          created_at: new Date().toISOString(),
          device_id: getDeviceId(),
        };

        if (creditId) {
          set({
            credits: get().credits.map((c) =>
              c.id === creditId ? { ...c, sale_id: sale.id } : c
            ),
          });
        }

        // Deduct stock
        const newProducts = products.map((p) => {
          const item = cart.find((c) => c.product_id === p.id);
          if (!item) return p;
          return {
            ...p,
            stock_quantity: Math.max(0, p.stock_quantity - item.quantity),
            updated_at: new Date().toISOString(),
          };
        });

        set({
          sales: [sale, ...get().sales],
          products: newProducts,
          cart: [],
        });
        get().logActivity("Sale completed", `${sale.sale_number} · ${method} · ${total}`);
        void writeSaleTransaction(sale, newProducts).catch((e) =>
          console.warn("[Dexie] sale tx", e)
        );
        // Queue sale + stock BEFORE sync so other devices get both
        enqueueSync("sale", sale);
        for (const p of newProducts) {
          const sold = sale.items.some((i) => i.product_id === p.id);
          if (sold) enqueueSync("product_upsert", p);
        }
        if (method === "credit") {
          const cr = get().credits.find((c) => c.id === creditId);
          if (cr) enqueueSync("credit_payment", { type: "credit_open", credit: cr, sale_id: sale.id });
        }
        try { flushDexieSave(get()); } catch { /* ignore */ }
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const st = useSyncStore.getState();
          if (st.isOnline) void st.syncNow({ silent: true });
        });
        return sale;
      },

      payCredit: (creditId, amount, method) => {
        const { credits, session, sales } = get();
        if (!session) return;
        const credit = credits.find((c) => c.id === creditId);
        if (!credit || amount <= 0) return;

        const payAmount = Math.min(amount, credit.balance);
        const newPaid = credit.amount_paid + payAmount;
        const newBalance = credit.original_amount - newPaid;
        const fullyPaid = newBalance <= 0;

        const updated: Credit = {
          ...credit,
          amount_paid: newPaid,
          balance: Math.max(0, newBalance),
          updated_at: new Date().toISOString(),
          fully_paid_at: fullyPaid ? new Date().toISOString() : credit.fully_paid_at,
          payments: [
            ...credit.payments,
            { amount: payAmount, method, paid_at: new Date().toISOString(), recorded_by: session.full_name },
          ],
        };

        // Record as sale for the day (credit paid)
        const creditSale: Sale = {
          id: uid(),
          sale_number: generateSaleNumber(get().sales),
          items: [],
          subtotal: payAmount,
          total: payAmount,
          payment_method: method,
          amount_paid: payAmount,
          change_given: 0,
          credit_customer_name: credit.customer_name,
          credit_id: credit.id,
          cashier_id: session.id,
          cashier_name: session.full_name,
          status: "completed",
          is_credit_payment: true,
          created_at: new Date().toISOString(),
          device_id: getDeviceId(),
        };

        set({
          credits: credits.map((c) => (c.id === creditId ? updated : c)),
          sales: [creditSale, ...sales],
        });
        get().logActivity("Credit payment", `${credit.customer_name} · ${payAmount}`);
        enqueueSync("credit_payment", {
          type: "credit_pay",
          credit_id: creditId,
          amount: payAmount,
          method,
          at: new Date().toISOString(),
          device_id: getDeviceId(),
        });
        // also push sale line if created for debt paid
        const lastSale = get().sales[0];
        if (lastSale?.is_credit_payment) enqueueSync("sale", lastSale);
      },


      returnProducts: (items, note) => {
        const session = get().session;
        if (!session || !items.length) return;
        const now = new Date().toISOString();
        const returns = items.map((it) => ({
          id: uid(),
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          amount: it.quantity * it.unit_price,
          note,
          cashier_id: session.id,
          cashier_name: session.full_name,
          created_at: now,
        }));
        const products = get().products.map((p) => {
          const r = items.find((i) => i.product_id === p.id);
          if (!r) return p;
          return {
            ...p,
            stock_quantity: p.stock_quantity + r.quantity,
            updated_at: now,
          };
        });
        set({
          productReturns: [...returns, ...get().productReturns],
          products,
        });
        get().logActivity("Product return", items.map((i) => `${i.quantity}× ${i.product_name}`).join(", "));
        for (const ret of returns) {
          enqueueSync("product_return", ret);
        }
        for (const p of products) {
          if (items.some((i) => i.product_id === p.id)) enqueueSync("product_upsert", p);
        }
        try { flushDexieSave(get()); } catch { /* ignore */ }
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const st = useSyncStore.getState();
          if (st.isOnline) void st.syncNow({ silent: true });
        });
      },

      addExpense: (description, amount, category) => {
        const session = get().session;
        if (!session) return;
        const exp: Expense = {
          id: uid(),
          description,
          amount,
          category,
          recorded_by: session.id,
          recorded_by_name: session.full_name,
          created_at: new Date().toISOString(),
        };
        set({ expenses: [exp, ...get().expenses] });
        get().logActivity("Expense recorded", description);
        enqueueSync("expense", exp);
      },

      deleteExpense: (id) => {
        const exp = get().expenses.find((e) => e.id === id);
        set({ expenses: get().expenses.filter((e) => e.id !== id) });
        if (exp) get().logActivity("Expense deleted", exp.description);
        enqueueSync("expense_delete", { id });
      },

      addSupplier: (s) => {
        const supplier: Supplier = { ...s, id: uid(), created_at: new Date().toISOString() };
        set({ suppliers: [...get().suppliers, supplier] });
        get().logActivity("Supplier added", supplier.name);
        enqueueSync("supplier_upsert", supplier);
      },

      deleteSupplier: (id) => {
        const s = get().suppliers.find((x) => x.id === id);
        set({ suppliers: get().suppliers.filter((x) => x.id !== id) });
        if (s) get().logActivity("Supplier deleted", s.name);
        enqueueSync("supplier_delete", { id });
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const st = useSyncStore.getState();
          if (st.isOnline) void st.syncNow({ silent: true });
        });
      },

      receiveStock: (productId, quantity, totalCost, supplierName, receiptNo) => {
        const session = get().session;
        const product = get().products.find((p) => p.id === productId);
        if (!session || !product || quantity <= 0 || totalCost < 0) return;

        // quantity = packs if units_per_pack > 1, else sell units
        const packSize = Math.max(1, product.units_per_pack || 1);
        const unitsAdded = quantity * packSize;
        if (unitsAdded <= 0) return;
        const unitCost =
          unitsAdded > 0 ? Math.round(totalCost / unitsAdded) : product.cost;
        const now = new Date().toISOString();

        const updatedProd: Product = {
          ...product,
          stock_quantity: product.stock_quantity + unitsAdded,
          cost: unitCost,
          updated_at: now,
        };

        const rec: StockReceive = {
          id: uid(),
          product_id: productId,
          product_name: product.name,
          quantity: unitsAdded,
          total_cost: totalCost,
          unit_cost: unitCost,
          supplier_name: supplierName,
          receipt_no: receiptNo,
          received_by: session.id,
          received_by_name: session.full_name,
          created_at: now,
          seen_by_admin: session.role === "admin",
        };

        set({
          stockReceives: [rec, ...get().stockReceives],
          products: get().products.map((p) =>
            p.id === productId ? updatedProd : p
          ),
        });

        get().logActivity(
          "Stock received",
          `${product.name}: +${unitsAdded} units (qty ${quantity} × pack ${packSize})`
        );

        // Cloud: receive log + product stock (must use updatedProd, not stale state)
        enqueueSync("stock_receive", rec);
        enqueueSync("product_upsert", updatedProd);
        try {
          flushDexieSave(get());
        } catch {
          /* ignore */
        }
        void import("@/stores/syncStore").then(({ useSyncStore }) => {
          const st = useSyncStore.getState();
          if (st.isOnline) void st.syncNow({ silent: true });
        });
      },

      auditStock: (productId, newQty, note) => {
        const session = get().session;
        const product = get().products.find((p) => p.id === productId);
        if (!session || !product) return;
        const audit: StockAudit = {
          id: uid(),
          product_id: productId,
          product_name: product.name,
          previous_qty: product.stock_quantity,
          new_qty: newQty,
          difference: newQty - product.stock_quantity,
          audited_by: session.id,
          audited_by_name: session.full_name,
          note,
          created_at: new Date().toISOString(),
          seen_by_admin: session.role === "admin",
        };
        set({
          stockAudits: [audit, ...get().stockAudits],
          products: get().products.map((p) =>
            p.id === productId
              ? { ...p, stock_quantity: newQty, updated_at: new Date().toISOString() }
              : p
          ),
        });
        get().logActivity("Stock audit", `${product.name}: ${product.stock_quantity} → ${newQty}`);
        enqueueSync("stock_audit", audit);
        const audited = get().products.find((x) => x.id === productId);
        if (audited) enqueueSync("product_upsert", audited);
      },

      markReceivesSeen: () => {
        set({
          stockReceives: get().stockReceives.map((r) => ({ ...r, seen_by_admin: true })),
        });
      },

      markAuditsSeen: () => {
        set({
          stockAudits: get().stockAudits.map((a) => ({ ...a, seen_by_admin: true })),
        });
      },

      logActivity: (action, details) => {
        const important = [
          "Sale completed",
          "Sale held",
          "Credit payment",
          "Stock received",
          "Stock audit",
          "Expense recorded",
          "Product added",
          "User removed",
          "System reset",
          "Supplier added",
        ];
        if (!important.some((a) => action.startsWith(a) || action === a)) return;
        const session = get().session;
        const log: ActivityLog = {
          id: uid(),
          user_id: session?.id || "system",
          user_name: session?.full_name || "System",
          action,
          details,
          created_at: new Date().toISOString(),
        };
        set({ activityLog: [log, ...get().activityLog].slice(0, 200) });
      },

      updateSettings: (patch) => {
        const next = { ...get().settings, ...patch };
        set({ settings: next });
        // Theme + printer are per-device — do not push to cloud
        const {
          theme: _t,
          preferred_printer: _p,
          auto_print_receipt: _a,
          ...cloudPayload
        } = next as typeof next & Record<string, unknown>;
        enqueueSync("settings_upsert", cloudPayload);
      },

      resetSystem: async () => {
        const freshAdmin = {
          ...DEFAULT_ADMIN,
          id: "u-admin",
          full_name: "System Admin",
          username: "admin",
          pin: "1234",
          role: "admin" as const,
          allowed_tabs: [...ALL_TABS],
          is_active: true,
          created_at: new Date().toISOString(),
        };

        // 0) Cancel any pending debounced Dexie write that still holds old sales/etc.
        try {
          const { cancelPendingDexieSave } = await import("@/db/bridge");
          cancelPendingDexieSave();
        } catch { /* ignore */ }

        // 1) Local Zustand — empty products and all business data (dashboard/reports read from here)
        set({
          products: [],
          cart: [],
          heldSales: [],
          sales: [],
          credits: [],
          productReturns: [],
          expenses: [],
          stockReceives: [],
          stockAudits: [],
          activityLog: [],
          suppliers: [],
          users: [freshAdmin],
          session: null,
          settings: { ...DEFAULT_SETTINGS },
        });

        // 2) Dexie IndexedDB — clear then write empty snapshot so a later timer cannot restore old data
        try {
          const { clearAllBusinessData } = await import("@/db/schema");
          await clearAllBusinessData();
          const { flushDexieSave } = await import("@/db/bridge");
          flushDexieSave(get());
        } catch (e) {
          console.warn("[reset] Dexie clear", e);
        }

        // 3) Sync queue
        try {
          const { useSyncStore } = await import("@/stores/syncStore");
          useSyncStore.setState({ pendingOps: [] });
        } catch (e) {
          console.warn("[reset] sync queue", e);
        }

        // 4) Cloud Supabase — delete products, sales, etc.
        let cloudMsg = "Cloud not wiped (offline or not configured).";
        try {
          const { useSyncStore } = await import("@/stores/syncStore");
          const { wipeAllCloudTables, isCloudReady } = await import("@/lib/supabase");
          const cloud = useSyncStore.getState().cloud;
          if (isCloudReady(cloud) && navigator.onLine) {
            const result = await wipeAllCloudTables(cloud);
            cloudMsg = result.ok
              ? "Cloud database wiped (including products)."
              : `Cloud wipe partial: ${result.errors.join("; ")}`;
          }
        } catch (e) {
          cloudMsg = e instanceof Error ? e.message : "Cloud wipe failed";
        }

        // 5) Wipe persisted browser storage so refresh cannot restore old tabs
        try {
          localStorage.removeItem("barpos-v2");
          localStorage.removeItem("barpos-sync-v1");
        } catch { /* ignore */ }

        // 6) Clear Dexie settings row + re-flush empty state (persist middleware may have rewritten localStorage)
        try {
          const { db } = await import("@/db/schema");
          await db.settings.clear();
          const { flushDexieSave, cancelPendingDexieSave } = await import("@/db/bridge");
          cancelPendingDexieSave();
          flushDexieSave(get());
        } catch { /* ignore */ }

        // 7) Re-clear Zustand persist key after flush (persist writes on set)
        try {
          localStorage.removeItem("barpos-v2");
        } catch { /* ignore */ }

        return {
          ok: true,
          message: `Everything cleared (all tabs + cloud). ${cloudMsg} Login PIN 1234.`,
        };
      },

      // "Today" = current business day (resets every day at 09:00). Sales are never deleted.
      getTodaySales: (cashierId) => {
        const sales = get().sales.filter(
          (s) => s.status === "completed" && isInCurrentBusinessDay(s.created_at)
        );
        return cashierId ? sales.filter((s) => s.cashier_id === cashierId) : sales;
      },

      // Previous business day (still available for admin comparison / history)
      getYesterdaySales: () => {
        return get().sales.filter(
          (s) => s.status === "completed" && isInPreviousBusinessDay(s.created_at)
        );
      },
    }),
    {
      name: "barpos-v2",
      merge: (persisted: any, current) => {
        const p = persisted as Partial<typeof current> | undefined;
        if (!p) return current;
        const products = (p.products || current.products || []).map((prod: any) => ({
          min_stock: 0,
          units_per_pack: 1,
          is_active: true,
          ...prod,
        }));
        return {
          ...current,
          ...p,
          products: products.length ? products : current.products,
          sales: (p.sales && p.sales.length) ? p.sales : (current.sales || []),
          users: (p.users && p.users.length) ? p.users : (current.users || []),
          settings: { ...current.settings, ...(p.settings || {}) },
        };
      },
      partialize: (s) => ({
        users: s.users,
        products: s.products,
        sales: s.sales,
        credits: s.credits,
        productReturns: s.productReturns,
        expenses: s.expenses,
        suppliers: s.suppliers,
        stockReceives: s.stockReceives,
        stockAudits: s.stockAudits,
        activityLog: s.activityLog,
        settings: s.settings,
        heldSales: s.heldSales,
        // session intentionally not persisted – force login
      }),
    }
  )
);
