import { useOrderStore } from "@/stores/orderStore";
import { useUIStore } from "@/stores/uiStore";
import { formatMoney } from "@/lib/utils";
import { Minus, Plus, Trash2, MapPin } from "lucide-react";

export function OrderPanel() {
  const currentOrder = useOrderStore((s) => s.currentOrder);
  const updateItemQuantity = useOrderStore((s) => s.updateItemQuantity);
  const removeItem = useOrderStore((s) => s.removeItem);
  const setShowTablePicker = useOrderStore((s) => s.setShowTablePicker);
  const holdCurrentOrder = useOrderStore((s) => s.holdCurrentOrder);
  const showInfo = useUIStore((s) => s.showInfo);

  if (!currentOrder) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-5 p-6">
        <div className="text-center">
          <p className="text-xl font-medium text-slate-500">No active order</p>
          <p className="text-sm mt-1">Start a new order or open an existing tab</p>
        </div>
        <button
          onClick={() => setShowTablePicker(true)}
          className="px-8 py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition text-lg"
        >
          Start New Order
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <div>
          <div className="font-bold text-lg tracking-tight">{currentOrder.order_number}</div>
          <button
            onClick={() => setShowTablePicker(true)}
            className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 font-medium mt-0.5"
          >
            <MapPin size={14} />
            {currentOrder.table_label || "Select table"}
          </button>
        </div>
        <div className="text-right text-sm text-slate-500">
          {new Date(currentOrder.opened_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {currentOrder.items.length === 0 ? (
          <p className="text-center text-slate-400 mt-10">Tap products on the left to add</p>
        ) : (
          currentOrder.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 p-3 bg-white rounded-xl border border-slate-200 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 truncate">
                  {item.product_name}
                </div>
                {item.modifiers.length > 0 && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {item.modifiers.map((m) => m.name).join(", ")}
                  </div>
                )}
                <div className="text-sm text-amber-600 font-bold mt-1">
                  {formatMoney(item.line_total)}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95"
                >
                  <Minus size={18} />
                </button>
                <span className="w-9 text-center font-bold text-base">{item.quantity}</span>
                <button
                  onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95"
                >
                  <Plus size={18} />
                </button>
                <button
                  onClick={() => removeItem(item.id)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 active:scale-95 ml-1"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Totals + Hold */}
      <div className="border-t border-slate-200 bg-white p-4 space-y-2 shrink-0">
        <div className="flex justify-between text-sm text-slate-600">
          <span>Subtotal</span>
          <span>{formatMoney(currentOrder.subtotal)}</span>
        </div>
        {currentOrder.discount_amount > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>Discount</span>
            <span>-{formatMoney(currentOrder.discount_amount)}</span>
          </div>
        )}
        <div className="flex justify-between text-2xl font-extrabold pt-2 border-t border-slate-100">
          <span>Total</span>
          <span className="text-amber-600">{formatMoney(currentOrder.total)}</span>
        </div>

        {currentOrder.items.length > 0 && (
          <button
            onClick={() => {
              holdCurrentOrder();
              showInfo("Order held — open it anytime from Open Tabs");
            }}
            className="w-full mt-2 py-3 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 active:scale-[0.98] transition"
          >
            Hold / Open Tab
          </button>
        )}
      </div>
    </div>
  );
}
