import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isSupabaseConfigured } from '../lib/supabase';
import { serverCompleteSale, cartToServerItems } from '../lib/api';
import { isOnline, enqueueSale, enqueueProduct, enqueueProductPatch, enqueueCreditPayment, enqueueCloudUpsert, enqueueCloudDelete, enqueueProductDelete, enqueueStockReceive, enqueueStockAudit, flushOfflineQueue, removeProductFromQueue } from '../lib/offline';
import { markProductDeleted, markHeldDeleted } from '../lib/tombstones';
import type {
  Product, CartItem, Sale, HeldSale, Credit, Expense,
  UserProfile, AppSettings, Notification, TabId, StockReceive, ActivityLogEntry
} from '../types';

/** Nudge open tabs / other devices to pull after a cloud write is queued. */
function notifyLocalWrite() {
  try {
    window.dispatchEvent(new CustomEvent('pub-pos-local-write'));
  } catch {
    /* ignore */
  }
}

/** Remember a product edit for ~30s so a mid-flight cloud pull cannot undo is_active / stock. */
function guardProductEdit(p: { id: string; is_active?: boolean; stock?: number; price?: number; cost?: number; name?: string }) {
  try {
    const raw = sessionStorage.getItem('pub-pos-product-guards');
    const map = raw ? JSON.parse(raw) : {};
    map[p.id] = {
      at: Date.now(),
      is_active: p.is_active !== false,
      stock: p.stock,
      price: p.price,
      cost: p.cost,
      name: p.name,
    };
    sessionStorage.setItem('pub-pos-product-guards', JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

interface AppState {
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  staffUsers: UserProfile[];
  setStaffUsers: (u: UserProfile[]) => void;
  updateStaffUser: (id: string, data: Partial<UserProfile>) => void;
  addStaffUser: (u: UserProfile) => { ok: boolean; error?: string };
  removeStaffUser: (id: string) => void;

  products: Product[];
  setProducts: (p: Product[]) => void;
  addProduct: (p: Product) => { ok: boolean; error?: string };
  updateProduct: (id: string, data: Partial<Product>) => { ok: boolean; error?: string };
  deleteProduct: (id: string) => void;

  cart: CartItem[];
  addToCart: (productId: string, qty?: number) => { ok: boolean; error?: string };
  removeFromCart: (productId: string) => void;
  updateCartQty: (productId: string, qty: number) => { ok: boolean; error?: string };
  clearCart: () => void;

  heldSales: HeldSale[];
  holdSale: (customerName: string) => void;
  resumeHeldSale: (id: string) => { ok: boolean; error?: string };
  removeHeldSale: (id: string) => void;
  cleanExpiredHolds: () => void;

  sales: Sale[];
  addSale: (sale: Sale) => void;
  /** Complete sale: validates stock from live products, deducts live stock */
  completeSaleFromCartAsync: (opts: {
    method: 'cash' | 'credit';
    creditorName?: string;
    cashierId: string;
    cashierName: string;
    discountPercent?: number;
    discountAmount?: number;
  }) => Promise<{ ok: boolean; error?: string; sale?: Sale }>;
  completeSaleFromCart: (opts: {
    method: 'cash' | 'credit';
    creditorName?: string;
    cashierId: string;
    cashierName: string;
    discountPercent?: number;
    discountAmount?: number;
  }) => { ok: boolean; error?: string; sale?: Sale };

  credits: Credit[];
  addCredit: (c: Credit) => void;
  recordCreditPayment: (creditId: string, amount: number, by: string, byName: string) => { ok: boolean; error?: string; paid?: number };

  expenses: Expense[];
  addExpense: (e: Expense) => void;

  stockReceives: StockReceive[];
  addStockReceive: (r: StockReceive) => void;
  applyLocalStockChange: (productId: string, changes: { stock: number; cost?: number }) => void;

  activityLogs: ActivityLogEntry[];
  logActivity: (userId: string, userName: string, action: string, details?: string) => void;

  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'created_at' | 'is_read'>) => void;
  markNotificationRead: (id: string) => void;
  markAllRead: () => void;

  settings: AppSettings;
  updateSettings: (s: Partial<AppSettings>) => void;

  /** ISO timestamp of last successful cloud pull (not persisted). */
  lastSyncAt: string | null;
  setLastSyncAt: (iso: string | null) => void;

  activeTab: TabId;
  setActiveTab: (t: TabId) => void;

  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      setCurrentUser: (user) => {
        try {
          if (user) {
            sessionStorage.setItem('pub-pos-session-user', JSON.stringify(user));
          } else {
            sessionStorage.removeItem('pub-pos-session-user');
          }
        } catch { /* ignore */ }
        set({ currentUser: user });
      },
      staffUsers: [],
      setStaffUsers: (staffUsers) => set({ staffUsers }),
      updateStaffUser: (id, data) =>
        set((s) => ({
          staffUsers: s.staffUsers.map((u) => (u.id === id ? { ...u, ...data } : u)),
          currentUser:
            s.currentUser?.id === id ? { ...s.currentUser, ...data } : s.currentUser,
        })),
      addStaffUser: (u) => {
        const exists = get().staffUsers.some(
          (x) => x.pin === u.pin || x.email.toLowerCase() === u.email.toLowerCase()
        );
        if (exists) return { ok: false, error: 'PIN or email already in use' };
        set((s) => ({ staffUsers: [...s.staffUsers, u] }));
        return { ok: true };
      },
      removeStaffUser: (id) =>
        set((s) => ({
          staffUsers: s.staffUsers.filter((u) => u.id !== id || u.role === 'admin'),
        })),

      products: [],
      setProducts: (products) => set({ products }),
      applyLocalStockChange: (productId, changes) => {
        set((s) => ({ products: s.products.map((p) => p.id === productId ? { ...p, ...changes } : p) }));
      },
      addProduct: (p) => {
        const exists = get().products.some(
          (x) => x.sku.toLowerCase() === p.sku.toLowerCase()
        );
        if (exists) return { ok: false, error: 'SKU already exists' };
        const product = { ...p, is_active: p.is_active !== false };
        set((s) => ({ products: [...s.products, product] }));
        guardProductEdit(product);
        if (isSupabaseConfigured) {
          enqueueProduct(product);
          notifyLocalWrite();
        }
        return { ok: true };
      },
      updateProduct: (id, data) => {
        const previous = get().products.find((p) => p.id === id);
        if (!previous) return { ok: false, error: 'Product not found' };
        if (data.sku) {
          const clash = get().products.some(
            (x) => x.id !== id && x.sku.toLowerCase() === data.sku!.toLowerCase()
          );
          if (clash) return { ok: false, error: 'SKU already exists' };
        }
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...data } : p)),
          cart: s.cart.map((c) =>
            c.product.id === id ? { ...c, product: { ...c.product, ...data } } : c
          ),
        }));
        const updated = get().products.find((p) => p.id === id);
        if (updated) {
          // Guard Active/Inactive (and stock) so a hot pull cannot flip the toggle back.
          guardProductEdit({ ...updated, stock: undefined });
          if (isSupabaseConfigured) {
            const { stock, ...metadata } = data;
            if (stock !== undefined && Number(stock) !== Number(previous.stock)) {
              enqueueStockAudit({
                adjustmentId: crypto.randomUUID(), productId: id, delta: Number(stock) - Number(previous.stock),
                reason: 'Product stock edited', createdAt: new Date().toISOString(),
              });
            }
            enqueueProductPatch(id, metadata);
            notifyLocalWrite();
          }
        }
        return { ok: true };
      },
      deleteProduct: (id) => {
        // Tombstone + purge offline queue first so the next pull/flush cannot restore it.
        markProductDeleted(id);
        removeProductFromQueue(id);
        set((s) => ({
          products: s.products.filter((p) => p.id !== id),
          cart: s.cart.filter((c) => c.product.id !== id),
          heldSales: s.heldSales
            .map((h) => ({
              ...h,
              items: h.items.filter((i) => i.product.id !== id),
            }))
            .filter((h) => h.items.length > 0),
        }));
        if (isSupabaseConfigured) {
          enqueueProductDelete(id);
          notifyLocalWrite();
        }
      },

      cart: [],
      addToCart: (productId, qty = 1) => {
        if (!Number.isFinite(qty) || qty <= 0) {
          return { ok: false, error: 'Invalid quantity' };
        }
        const product = get().products.find((p) => p.id === productId);
        if (!product || product.is_active === false) {
          return { ok: false, error: 'Product not available' };
        }
        if (product.stock <= 0) {
          return { ok: false, error: 'Out of stock' };
        }
        const existing = get().cart.find((c) => c.product.id === productId);
        const currentQty = existing?.quantity || 0;
        const next = currentQty + qty;
        if (next > product.stock) {
          return { ok: false, error: `Only ${product.stock} in stock` };
        }
        if (existing) {
          set((s) => ({
            cart: s.cart.map((c) =>
              c.product.id === productId
                ? { ...c, quantity: next, product: { ...product } }
                : c
            ),
          }));
        } else {
          set((s) => ({
            cart: [...s.cart, { product: { ...product }, quantity: qty }],
          }));
        }
        return { ok: true };
      },
      removeFromCart: (productId) =>
        set((s) => ({ cart: s.cart.filter((c) => c.product.id !== productId) })),
      updateCartQty: (productId, qty) => {
        if (qty <= 0) {
          set((s) => ({ cart: s.cart.filter((c) => c.product.id !== productId) }));
          return { ok: true };
        }
        const product = get().products.find((p) => p.id === productId);
        if (!product) return { ok: false, error: 'Product not found' };
        if (qty > product.stock) {
          return { ok: false, error: `Only ${product.stock} in stock` };
        }
        set((s) => ({
          cart: s.cart.map((c) =>
            c.product.id === productId
              ? { ...c, quantity: qty, product: { ...product } }
              : c
          ),
        }));
        return { ok: true };
      },
      clearCart: () => set({ cart: [] }),

      heldSales: [],
      holdSale: (customerName) => {
        try {
          const { cart, currentUser } = get();
          if (cart.length === 0 || !customerName?.trim()) return;
          const now = new Date();
          const expires = new Date(now.getTime() + 6 * 60 * 60 * 1000);
          // Strip to plain JSON-safe product fields so upsert never throws on
          // unexpected properties and the Sell screen cannot white-screen.
          const items = cart.map((c) => ({
            product: {
              id: c.product.id,
              sku: c.product.sku,
              name: c.product.name,
              category: c.product.category,
              price: c.product.price,
              cost: c.product.cost,
              stock: c.product.stock,
              low_stock_threshold: c.product.low_stock_threshold,
              is_barrel: !!c.product.is_barrel,
              barrel_cups: c.product.barrel_cups,
              is_active: c.product.is_active !== false,
              image_url: c.product.image_url,
            },
            quantity: c.quantity,
          }));
          const held: HeldSale = {
            id: crypto.randomUUID(),
            items,
            customer_name: customerName.trim(),
            created_at: now.toISOString(),
            expires_at: expires.toISOString(),
          };
          set((s) => ({
            heldSales: [...s.heldSales, held],
            cart: [],
          }));
          if (isSupabaseConfigured) {
            enqueueCloudUpsert('held_sales', {
              id: held.id,
              customer_name: held.customer_name,
              items: held.items,
              cashier_id: currentUser?.id || null,
              created_at: held.created_at,
              expires_at: held.expires_at,
            });
            notifyLocalWrite();
          }
        } catch (e) {
          console.warn('holdSale failed', e);
        }
      },
      resumeHeldSale: (id) => {
        const held = get().heldSales.find((h) => h.id === id);
        if (!held) return { ok: false, error: 'Held sale not found' };
        const cart = get().cart;
        if (cart.length > 0) {
          return { ok: false, error: 'Clear or complete current cart before resuming a held sale' };
        }
        // Re-validate stock against live products
        for (const item of held.items) {
          const live = get().products.find((p) => p.id === item.product.id);
          if (!live || live.is_active === false) {
            return { ok: false, error: `${item.product.name} is no longer available` };
          }
          if (item.quantity > live.stock) {
            return {
              ok: false,
              error: `${item.product.name}: only ${live.stock} left (held ${item.quantity})`,
            };
          }
        }
        markHeldDeleted(id);
        set((s) => ({
          cart: held.items.map((i) => {
            const live = s.products.find((p) => p.id === i.product.id)!;
            return { product: { ...live }, quantity: i.quantity };
          }),
          heldSales: s.heldSales.filter((h) => h.id !== id),
        }));
        // Remove from cloud so a later pull does not put the held sale back.
        if (isSupabaseConfigured) enqueueCloudDelete('held_sales', id);
        return { ok: true };
      },
      removeHeldSale: (id) => {
        markHeldDeleted(id);
        set((s) => ({ heldSales: s.heldSales.filter((h) => h.id !== id) }));
        if (isSupabaseConfigured) enqueueCloudDelete('held_sales', id);
      },
      cleanExpiredHolds: () => {
        const now = Date.now();
        const expired = get().heldSales.filter(
          (h) => new Date(h.expires_at).getTime() <= now
        );
        if (expired.length === 0) return;
        // Tombstone + remote delete so a later cloud pull cannot bring them back.
        for (const h of expired) {
          markHeldDeleted(h.id);
          if (isSupabaseConfigured) enqueueCloudDelete('held_sales', h.id);
        }
        set((s) => ({
          heldSales: s.heldSales.filter(
            (h) => new Date(h.expires_at).getTime() > now
          ),
        }));
      },

      sales: [],
      addSale: (sale) => set((s) => ({ sales: [sale, ...s.sales] })),
      completeSaleFromCart: ({ method, creditorName, cashierId, cashierName, discountPercent = 0, discountAmount = 0 }) => {
        const { cart, products } = get();
        if (cart.length === 0) return { ok: false, error: 'Cart is empty' };
        if (method === 'credit' && !creditorName?.trim()) {
          return { ok: false, error: 'Creditor name required' };
        }

        for (const c of cart) {
          const live = products.find((p) => p.id === c.product.id);
          if (!live || live.is_active === false) {
            return { ok: false, error: `${c.product.name} is unavailable` };
          }
          if (c.quantity > live.stock) {
            return {
              ok: false,
              error: `${live.name}: only ${live.stock} in stock`,
            };
          }
        }

        const items = cart.map((c) => {
          const live = products.find((p) => p.id === c.product.id)!;
          return {
            product_id: live.id,
            name: live.name,
            qty: c.quantity,
            price: live.price,
            cost: live.cost,
          };
        });
        const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
        let discount = 0;
        if (discountPercent > 0) discount = subtotal * (Math.min(100, discountPercent) / 100);
        if (discountAmount > 0) discount = Math.max(discount, Math.min(subtotal, discountAmount));
        discount = Math.round(discount * 100) / 100;
        const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
        const cost_total = items.reduce((s, i) => s + i.cost * i.qty, 0);
        const receiptNo = `R${Date.now().toString().slice(-8)}`;
        const sale: Sale = {
          id: crypto.randomUUID(),
          items: discount > 0
            ? [...items, { product_id: '_discount', name: `Discount`, qty: 1, price: -discount, cost: 0 }]
            : items,
          total,
          cost_total,
          payment_method: method,
          creditor_name: creditorName,
          cashier_id: cashierId,
          cashier_name: cashierName,
          created_at: new Date().toISOString(),
          receipt_no: receiptNo,
        };

        // Deduct from live stock
        set((s) => ({
          products: s.products.map((p) => {
            const line = cart.find((c) => c.product.id === p.id);
            if (!line) return p;
            return { ...p, stock: Math.max(0, p.stock - line.quantity) };
          }),
          sales: [sale, ...s.sales],
          cart: [],
        }));

        if (method === 'credit' && creditorName) {
          get().addCredit({
            id: crypto.randomUUID(),
            customer_name: creditorName,
            amount: total,
            paid_amount: 0,
            remaining: total,
            sale_id: sale.id,
            created_at: sale.created_at,
            payments: [],
          });
        }

        get().logActivity(
          cashierId,
          cashierName,
          method === 'credit' ? 'Credit sale' : 'Cash sale',
          `${sale.receipt_no} · ${total}`
        );

        return { ok: true, sale };
      },


      /** Supabase-first checkout. Online sales are not shown as completed until the
       * atomic server RPC commits both the sale and stock deduction. Only a device
       * that is actually offline may create a locally pending sale for later sync. */
      completeSaleFromCartAsync: async (opts) => {
        const cartSnapshot = get().cart.map((item) => ({
          product: { ...item.product },
          quantity: item.quantity,
        }));
        if (cartSnapshot.length === 0) return { ok: false, error: 'Cart is empty' };
        if (opts.method === 'credit' && !opts.creditorName?.trim()) {
          return { ok: false, error: 'Creditor name required' };
        }
        if (!isSupabaseConfigured) {
          return { ok: false, error: 'Supabase is not configured. Sales are disabled to protect stock accuracy.' };
        }

        // When online, Supabase is the authority. Never deduct stock or show a
        // completed sale locally before the database confirms the transaction.
        if (isOnline()) {
          const clientSaleId = crypto.randomUUID();
          const result = await serverCompleteSale({
            method: opts.method,
            creditorName: opts.creditorName,
            cashierId: opts.cashierId,
            cashierName: opts.cashierName,
            discountPercent: opts.discountPercent,
            clientSaleId,
            items: cartToServerItems(cartSnapshot),
          });
          if (!result.ok || !result.sale) {
            return { ok: false, error: result.error || 'Supabase did not commit the sale. No stock was deducted.' };
          }

          const stockMap = new Map((result.stockUpdates || []).map((u) => [u.id, u.stock]));
          set((state) => ({
            products: state.products.map((product) =>
              stockMap.has(product.id)
                ? { ...product, stock: stockMap.get(product.id)! }
                : product
            ),
            sales: [result.sale!, ...state.sales.filter((sale) => sale.id !== result.sale!.id)],
            cart: [],
          }));
          get().logActivity(
            opts.cashierId,
            opts.cashierName,
            opts.method === 'credit' ? 'Credit sale' : 'Cash sale',
            `${result.sale.receipt_no} · ${result.sale.total}`
          );
          notifyLocalWrite();
          return { ok: true, sale: result.sale };
        }

        // Offline-only path: save a durable pending transaction on this device.
        // It is not a committed/global sale until Supabase accepts it on reconnect.
        const local = get().completeSaleFromCart(opts);
        if (!local.ok || !local.sale) return local;
        enqueueSale({
          id: `sale:${local.sale.id}`,
          type: 'sale',
          payload: {
            method: opts.method,
            creditorName: opts.creditorName,
            cashierId: opts.cashierId,
            cashierName: opts.cashierName,
            discountPercent: opts.discountPercent,
            items: cartToServerItems(cartSnapshot),
            localSale: local.sale,
          },
          created_at: new Date().toISOString(),
        });
        notifyLocalWrite();
        return local;
      },
      credits: [],
      addCredit: (c) => set((s) => ({ credits: [c, ...s.credits] })),
      recordCreditPayment: (creditId, amount, by, byName) => {
        const credit = get().credits.find((c) => c.id === creditId);
        if (!credit) return { ok: false, error: 'Credit not found' };
        if (credit.remaining <= 0) return { ok: false, error: 'Already paid' };
        if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Invalid amount' };
        const paid = Math.min(credit.remaining, Math.round(amount * 100) / 100);

        // Queue before network I/O. The stable ID makes server retries safe.
        const paymentId = crypto.randomUUID();
        if (isSupabaseConfigured) {
          enqueueCreditPayment({ creditId, amount: paid, by, byName, clientPaymentId: paymentId });
          notifyLocalWrite();
        }

        set((s) => ({
          credits: s.credits.map((c) => {
            if (c.id !== creditId) return c;
            const newPaid = Math.round((c.paid_amount + paid) * 100) / 100;
            const remaining = Math.max(0, Math.round((c.amount - newPaid) * 100) / 100);
            return {
              ...c,
              paid_amount: newPaid,
              remaining,
              payments: [
                ...c.payments,
                {
                  id: paymentId,
                  credit_id: creditId,
                  amount: paid,
                  paid_at: new Date().toISOString(),
                  recorded_by: by,
                },
              ],
            };
          }),
        }));

        const collectionSale: Sale = {
          id: paymentId,
          items: [],
          total: paid,
          cost_total: 0,
          payment_method: 'credit_collection',
          creditor_name: credit.customer_name,
          cashier_id: by,
          cashier_name: byName,
          created_at: new Date().toISOString(),
          receipt_no: `CR${Date.now().toString().slice(-6)}`,
          is_credit_collection: true,
        };
        set((s) => ({ sales: [collectionSale, ...s.sales] }));

        get().logActivity(by, byName, 'Credit payment', `${credit.customer_name} · ${paid}`);
        return { ok: true, paid };
      },

      expenses: [],
      addExpense: (e) => {
        set((s) => ({ expenses: [e, ...s.expenses] }));
        if (isSupabaseConfigured) {
          enqueueCloudUpsert('expenses', { id: e.id, description: e.description, amount: e.amount, category: e.category || 'misc', note: e.note || null, created_by: e.created_by, created_at: e.created_at });
          notifyLocalWrite();
        }
      },

      stockReceives: [],
      addStockReceive: (r) => {
        set((s) => ({ stockReceives: [r, ...s.stockReceives] }));
        if (isSupabaseConfigured) {
          enqueueStockReceive({
            receiveId: r.id, productId: r.product_id, productName: r.product_name, quantity: r.quantity,
            barrels: r.barrels, unitCost: r.unit_cost, totalCost: r.total_cost, receiptNo: r.receipt_no,
            supplier: r.supplier, receivedBy: r.received_by, receivedByName: r.received_by_name, createdAt: r.created_at,
          });
          notifyLocalWrite();
        }
      },

      activityLogs: [],
      logActivity: (userId, userName, action, details) => {
        const entry = {
          id: crypto.randomUUID(),
          user_id: userId,
          user_name: userName,
          action,
          details,
          created_at: new Date().toISOString(),
        };
        set((s) => ({
          activityLogs: [entry, ...s.activityLogs].slice(0, 500),
        }));
        if (isSupabaseConfigured) {
          enqueueCloudUpsert('activity_logs', {
            id: entry.id, user_id: userId || null, user_name: userName,
            action, details: details || null, created_at: entry.created_at,
          });
          notifyLocalWrite();
        }
      },

      notifications: [],
      addNotification: (n) =>
        set((s) => ({
          notifications: [
            {
              ...n,
              id: crypto.randomUUID(),
              is_read: false,
              created_at: new Date().toISOString(),
            },
            ...s.notifications,
          ],
        })),
      markNotificationRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, is_read: true } : n
          ),
        })),
      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, is_read: true })),
        })),

      settings: {
        pub_name: 'Carwash Bar & Restaurant',
        logo_url: '/logo.png',
        till_number: 'TILL-001',
        receipt_footer: '',
        currency: 'KES',
        login_bg_url: undefined,
        business_day_hour: 9,
        receipt_show_cost: false,
      },
      updateSettings: (s) => {
        set((state) => ({ settings: { ...state.settings, ...s } }));
        if (typeof s.business_day_hour === 'number') {
          void import('../utils/businessDay').then(({ setBusinessDayCutOffHour }) => {
            setBusinessDayCutOffHour(s.business_day_hour!);
          });
        }
        if (isSupabaseConfigured) {
          const next = { ...get().settings, ...s };
          enqueueCloudUpsert('app_settings', {
            id: 1, pub_name: next.pub_name || 'My Pub', logo_url: next.logo_url || null,
            login_bg_url: next.login_bg_url || null, till_number: next.till_number || 'TILL-001',
            receipt_footer: next.receipt_footer || '', currency: 'KES',
            business_day_hour: next.business_day_hour ?? 9, receipt_show_cost: !!next.receipt_show_cost,
          });
          notifyLocalWrite();
        }
      },

      lastSyncAt: null,
      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),

      activeTab: 'dashboard',
      setActiveTab: (t) => set({ activeTab: t }),

      theme: (typeof localStorage !== 'undefined' &&
        localStorage.getItem('pub-pos-theme') === 'dark'
          ? 'dark'
          : 'light') as 'light' | 'dark',
      setTheme: (t) => {
        localStorage.setItem('pub-pos-theme', t);
        document.documentElement.classList.toggle('dark', t === 'dark');
        set({ theme: t });
      },
    }),
    {
      name: 'pub-pos-storage',
      partialize: (state) => ({
        products: state.products,
        sales: state.sales,
        credits: state.credits,
        expenses: state.expenses,
        settings: state.settings,
        heldSales: state.heldSales,
        staffUsers: state.staffUsers.map((u) => ({
          ...u,
          pin: '',
        })),
        cart: state.cart, // persist pending sale across idle logout / refresh
        stockReceives: state.stockReceives,
        activityLogs: state.activityLogs,
        notifications: state.notifications,
        // Keep current tab across refresh / background sync so user is not bounced to Dashboard
        activeTab: state.activeTab,
      }),
    }
  )
);

/** Restore logged-in user after browser refresh (same tab session only). */
export function hydrateSessionUser(): void {
  try {
    const raw = sessionStorage.getItem('pub-pos-session-user');
    if (!raw) return;
    const user = JSON.parse(raw);
    if (user && user.id) {
      useStore.setState({ currentUser: user });
    }
  } catch {
    /* ignore */
  }
}
