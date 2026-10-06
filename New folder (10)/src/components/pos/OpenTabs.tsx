import { useOrderStore } from "@/stores/orderStore";
import { formatMoney } from "@/lib/utils";
import { X, Clock } from "lucide-react";

export function OpenTabs() {
  const show = useOrderStore((s) => s.showOpenTabs);
  const setShow = useOrderStore((s) => s.setShowOpenTabs);
  const openOrders = useOrderStore((s) => s.openOrders);
  const loadOrder = useOrderStore((s) => s.loadOrder);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            Open Tabs ({openOrders.length})
          </h2>
          <button
            onClick={() => setShow(false)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {openOrders.length === 0 ? (
            <p className="text-center text-slate-400 py-12">No open tabs</p>
          ) : (
            <div className="space-y-2">
              {openOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => loadOrder(order.id)}
                  className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-amber-400 hover:bg-amber-50 active:scale-[0.99] transition text-left"
                >
                  <div>
                    <div className="font-bold text-slate-800">
                      {order.order_number}
                    </div>
                    <div className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                      <span className="font-medium text-slate-700">
                        {order.table_label || "No table"}
                      </span>
                      <span>·</span>
                      <Clock size={12} />
                      {new Date(order.opened_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-amber-600 text-lg">
                      {formatMoney(order.total)}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Tap to open</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
