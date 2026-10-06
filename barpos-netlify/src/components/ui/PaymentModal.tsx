import { useOrderStore } from "@/stores/orderStore";
import { useUIStore } from "@/stores/uiStore";
import { formatMoney } from "@/lib/utils";
import { X, Banknote, Smartphone, CreditCard } from "lucide-react";
import { useState } from "react";

type Method = "cash" | "mpesa" | "card";

const METHOD_META: Record<
  Method,
  { label: string; color: string; icon: typeof Banknote }
> = {
  cash: { label: "Cash", color: "bg-emerald-500", icon: Banknote },
  mpesa: { label: "M-Pesa", color: "bg-green-600", icon: Smartphone },
  card: { label: "Card", color: "bg-blue-600", icon: CreditCard },
};

interface Props {
  method: Method | null;
  onClose: () => void;
}

export function PaymentModal({ method, onClose }: Props) {
  const currentOrder = useOrderStore((s) => s.currentOrder);
  const markOrderPaid = useOrderStore((s) => s.markOrderPaid);
  const showSuccess = useUIStore((s) => s.showSuccess);
  const [cashReceived, setCashReceived] = useState("");

  if (!method || !currentOrder) return null;

  const meta = METHOD_META[method];
  const Icon = meta.icon;
  const total = currentOrder.total;
  const receivedCents = Math.round(parseFloat(cashReceived || "0") * 100);
  const change = method === "cash" ? Math.max(0, receivedCents - total) : 0;
  const canConfirm =
    method !== "cash" || (receivedCents >= total && cashReceived !== "");

  const handleConfirm = () => {
    markOrderPaid(method);
    showSuccess(
      method === "cash"
        ? `Paid with Cash · Change: ${formatMoney(change)}`
        : `Paid with ${meta.label}`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg text-white ${meta.color}`}>
              <Icon size={20} />
            </div>
            <h2 className="text-lg font-bold text-slate-800">{meta.label} Payment</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-center py-2">
            <div className="text-sm text-slate-500">Order total</div>
            <div className="text-3xl font-extrabold text-amber-600 mt-1">
              {formatMoney(total)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {currentOrder.order_number} · {currentOrder.table_label}
            </div>
          </div>

          {method === "cash" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Cash received (KSh)
              </label>
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                className="w-full text-2xl font-bold px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-amber-400 outline-none text-center"
              />
              {receivedCents >= total && cashReceived !== "" && (
                <div className="flex justify-between text-sm bg-emerald-50 text-emerald-800 px-3 py-2 rounded-lg">
                  <span>Change</span>
                  <span className="font-bold">{formatMoney(change)}</span>
                </div>
              )}
            </div>
          )}

          {method === "mpesa" && (
            <p className="text-sm text-slate-500 text-center">
              Customer will receive an M-Pesa STK Push prompt.
              <br />
              <span className="text-xs">(Live STK coming in Stage 3)</span>
            </p>
          )}

          {method === "card" && (
            <p className="text-sm text-slate-500 text-center">
              Process card on terminal, then confirm below.
              <br />
              <span className="text-xs">(Card integration in Stage 3)</span>
            </p>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 rounded-xl border-2 border-slate-200 font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={!canConfirm}
            onClick={handleConfirm}
            className={`flex-1 py-3.5 rounded-xl font-bold text-white disabled:opacity-40 ${meta.color} active:scale-[0.98] transition`}
          >
            Confirm Payment
          </button>
        </div>
      </div>
    </div>
  );
}
