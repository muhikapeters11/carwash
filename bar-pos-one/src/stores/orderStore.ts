import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Order, OrderItem, Product, ProductModifier } from "@/types";
import { generateOrderNumber } from "@/lib/utils";

function uid(): string {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface OrderState {
  currentOrder: Order | null;
  openOrders: Order[];
  showTablePicker: boolean;
  showOpenTabs: boolean;

  setShowTablePicker: (show: boolean) => void;
  setShowOpenTabs: (show: boolean) => void;
  startNewOrder: (tableLabel?: string, serverId?: string, serverName?: string) => void;
  addItem: (product: Product, quantity?: number, modifiers?: ProductModifier[], notes?: string) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  setTableLabel: (label: string) => void;
  applyDiscount: (amount: number) => void;
  holdCurrentOrder: () => void;
  loadOrder: (orderId: string) => void;
  closeOrder: (orderId: string) => void;
  clearCurrentOrder: () => void;
  markOrderPaid: (method: "cash" | "mpesa" | "card") => void;
}

function recalculateTotals(
  items: OrderItem[],
  discount = 0
): Pick<Order, "subtotal" | "discount_amount" | "tax_amount" | "total"> {
  const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);
  const tax_amount = 0;
  const total = Math.max(0, subtotal - discount + tax_amount);
  return { subtotal, discount_amount: discount, tax_amount, total };
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      currentOrder: null,
      openOrders: [],
      showTablePicker: false,
      showOpenTabs: false,

      setShowTablePicker: (show) => set({ showTablePicker: show }),
      setShowOpenTabs: (show) => set({ showOpenTabs: show }),

      startNewOrder: (tableLabel = "Bar", serverId, serverName) => {
        const now = new Date().toISOString();
        const order: Order = {
          id: uid(),
          order_number: generateOrderNumber(),
          status: "open",
          table_label: tableLabel,
          server_id: serverId,
          server_name: serverName,
          items: [],
          subtotal: 0,
          discount_amount: 0,
          tax_amount: 0,
          total: 0,
          amount_paid: 0,
          change_given: 0,
          opened_at: now,
          updated_at: now,
          device_id: "local-device",
          sync_status: "pending",
        };
        set({ currentOrder: order, showTablePicker: false, showOpenTabs: false });
      },

      addItem: (product, quantity = 1, modifiers = [], notes) => {
        const { currentOrder, startNewOrder } = get();
        let order = currentOrder;
        if (!order) {
          startNewOrder("Bar");
          order = get().currentOrder!;
        }

        const modifierTotal = modifiers.reduce((s, m) => s + m.price_adjustment, 0);
        const unitPrice = product.price + modifierTotal;
        const lineTotal = unitPrice * quantity;

        const newItem: OrderItem = {
          id: uid(),
          product_id: product.id,
          product_name: product.name,
          quantity,
          unit_price: unitPrice,
          modifiers: modifiers.map((m) => ({ name: m.name, price: m.price_adjustment })),
          notes,
          is_comped: false,
          line_total: lineTotal,
        };

        const items = [...order.items, newItem];
        const totals = recalculateTotals(items, order.discount_amount);

        set({
          currentOrder: {
            ...order,
            items,
            ...totals,
            updated_at: new Date().toISOString(),
            sync_status: "pending",
          },
        });
      },

      updateItemQuantity: (itemId, quantity) => {
        const { currentOrder } = get();
        if (!currentOrder) return;

        const items = currentOrder.items
          .map((item) => {
            if (item.id !== itemId) return item;
            if (quantity <= 0) return null;
            return {
              ...item,
              quantity,
              line_total: item.unit_price * quantity,
            };
          })
          .filter(Boolean) as OrderItem[];

        const totals = recalculateTotals(items, currentOrder.discount_amount);

        set({
          currentOrder: {
            ...currentOrder,
            items,
            ...totals,
            updated_at: new Date().toISOString(),
            sync_status: "pending",
          },
        });
      },

      removeItem: (itemId) => {
        const { currentOrder } = get();
        if (!currentOrder) return;

        const items = currentOrder.items.filter((i) => i.id !== itemId);
        const totals = recalculateTotals(items, currentOrder.discount_amount);

        set({
          currentOrder: {
            ...currentOrder,
            items,
            ...totals,
            updated_at: new Date().toISOString(),
            sync_status: "pending",
          },
        });
      },

      setTableLabel: (label) => {
        const { currentOrder } = get();
        if (!currentOrder) return;
        set({
          currentOrder: {
            ...currentOrder,
            table_label: label,
            updated_at: new Date().toISOString(),
            sync_status: "pending",
          },
          showTablePicker: false,
        });
      },

      applyDiscount: (amount) => {
        const { currentOrder } = get();
        if (!currentOrder) return;
        const totals = recalculateTotals(currentOrder.items, amount);
        set({
          currentOrder: {
            ...currentOrder,
            ...totals,
            updated_at: new Date().toISOString(),
            sync_status: "pending",
          },
        });
      },

      holdCurrentOrder: () => {
        const { currentOrder, openOrders } = get();
        if (!currentOrder || currentOrder.items.length === 0) return;

        const updated = {
          ...currentOrder,
          updated_at: new Date().toISOString(),
          sync_status: "pending" as const,
        };

        const exists = openOrders.findIndex((o) => o.id === updated.id);
        let newOpenOrders: Order[];
        if (exists >= 0) {
          newOpenOrders = [...openOrders];
          newOpenOrders[exists] = updated;
        } else {
          newOpenOrders = [...openOrders, updated];
        }

        set({
          openOrders: newOpenOrders,
          currentOrder: null,
        });
      },

      loadOrder: (orderId) => {
        const { openOrders, currentOrder, holdCurrentOrder } = get();
        const order = openOrders.find((o) => o.id === orderId);
        if (!order) return;

        if (currentOrder && currentOrder.items.length > 0) {
          holdCurrentOrder();
        }

        set({
          currentOrder: order,
          openOrders: get().openOrders.filter((o) => o.id !== orderId),
          showOpenTabs: false,
        });
      },

      closeOrder: (orderId) => {
        set((state) => ({
          openOrders: state.openOrders.filter((o) => o.id !== orderId),
          currentOrder: state.currentOrder?.id === orderId ? null : state.currentOrder,
        }));
      },

      clearCurrentOrder: () => set({ currentOrder: null }),

      markOrderPaid: (method) => {
        const { currentOrder, openOrders } = get();
        if (!currentOrder) return;

        const paid: Order = {
          ...currentOrder,
          status: "closed",
          payment_method: method,
          amount_paid: currentOrder.total,
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sync_status: "pending",
        };

        // Remove from open orders if present, clear current
        set({
          currentOrder: null,
          openOrders: openOrders.filter((o) => o.id !== paid.id),
        });

        // Keep a simple log in localStorage for now (Stage 2)
        try {
          const key = "barpos-closed-orders";
          const existing = JSON.parse(localStorage.getItem(key) || "[]") as Order[];
          existing.unshift(paid);
          localStorage.setItem(key, JSON.stringify(existing.slice(0, 100)));
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: "barpos-orders",
      partialize: (state) => ({
        currentOrder: state.currentOrder,
        openOrders: state.openOrders,
      }),
    }
  )
);
