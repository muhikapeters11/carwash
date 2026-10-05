import { useState } from "react";
import { useOrderStore } from "@/stores/orderStore";
import { PaymentModal } from "@/components/ui/PaymentModal";
import { Banknote, CreditCard, Smartphone, LayoutList, Plus } from "lucide-react";

type Method = "cash" | "mpesa" | "card";

export function ActionPanel() {
  const currentOrder = useOrderStore((s) => s.currentOrder);
  const openOrders = useOrderStore((s) => s.openOrders);
  const setShowTablePicker = useOrderStore((s) => s.setShowTablePicker);
  const setShowOpenTabs = useOrderStore((s) => s.setShowOpenTabs);
  const [payMethod, setPayMethod] = useState<Method | null>(null);

  const canPay = Boolean(
    currentOrder && currentOrder.items.length > 0 && currentOrder.total > 0
  );

  return (
    <>
      <div className="flex flex-col h-full p-3 gap-3">
        <div className="grid grid-cols-2 gap-2 shrink-0">
          <button
            onClick={() => setShowTablePicker(true)}
            className="flex items-center justify-center gap-2 py-3.5 px-2 rounded-xl bg-slate-800 text-white font-semibold text-sm active:scale-95 transition"
          >
            <Plus size={18} />
            New Order
          </button>
          <button
            onClick={() => setShowOpenTabs(true)}
            className="relative flex items-center justify-center gap-2 py-3.5 px-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm border border-slate-200 active:scale-95 transition"
          >
            <LayoutList size={18} />
            Open Tabs
            {openOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">
                {openOrders.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-3 justify-center">
          <button
            disabled={!canPay}
            onClick={() => setPayMethod("cash")}
            className="flex items-center gap-4 w-full py-5 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg shadow-md active:scale-[0.98] transition"
          >
            <Banknote size={28} strokeWidth={2.2} />
            <div className="text-left">
              <div>Cash</div>
              <div className="text-xs font-normal opacity-80">Cash & change</div>
            </div>
          </button>

          <button
            disabled={!canPay}
            onClick={() => setPayMethod("mpesa")}
            className="flex items-center gap-4 w-full py-5 px-5 rounded-2xl bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg shadow-md active:scale-[0.98] transition"
          >
            <Smartphone size={28} strokeWidth={2.2} />
            <div className="text-left">
              <div>M-Pesa</div>
              <div className="text-xs font-normal opacity-80">STK Push</div>
            </div>
          </button>

          <button
            disabled={!canPay}
            onClick={() => setPayMethod("card")}
            className="flex items-center gap-4 w-full py-5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg shadow-md active:scale-[0.98] transition"
          >
            <CreditCard size={28} strokeWidth={2.2} />
            <div className="text-left">
              <div>Card</div>
              <div className="text-xs font-normal opacity-80">Credit / Debit</div>
            </div>
          </button>
        </div>

        <div className="pt-2 border-t border-slate-200 text-center text-xs text-slate-400 shrink-0">
          Orders saved on this device
        </div>
      </div>

      <PaymentModal method={payMethod} onClose={() => setPayMethod(null)} />
    </>
  );
}
