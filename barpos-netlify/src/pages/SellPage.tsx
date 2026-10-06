import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney } from "@/lib/utils";
import type { PaymentMethod, Sale } from "@/types";
import { Minus, Plus, Trash2, Pause, Eraser, X } from "lucide-react";
import { useVirtualKeyboard } from "@/components/ui/VirtualKeyboard";
import { ProductGrid } from "@/components/sell/ProductGrid";
import { ThermalReceipt } from "@/components/ThermalReceipt";

export function SellPage() {
  const cart = useAppStore((s) => s.cart);
  const heldSales = useAppStore((s) => s.heldSales);
  const updateCartQty = useAppStore((s) => s.updateCartQty);
  const clearCart = useAppStore((s) => s.clearCart);
  const holdSale = useAppStore((s) => s.holdSale);
  const loadHeldSale = useAppStore((s) => s.loadHeldSale);
  const completeSale = useAppStore((s) => s.completeSale);
  const returnProducts = useAppStore((s) => s.returnProducts);
  const settings = useAppStore((s) => s.settings);
  const session = useAppStore((s) => s.session);
  const sales = useAppStore((s) => s.sales);
  const allProducts = useAppStore((s) => s.products);
  const lastSale = sales.find((s) => s.status === "completed" && s.cashier_id === session?.id)
    || sales.find((s) => s.status === "completed");

  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [creditName, setCreditName] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [showReturn, setShowReturn] = useState(false);
  const [retPid, setRetPid] = useState("");
  const [retQty, setRetQty] = useState("1");
  const [showHeld, setShowHeld] = useState(false);
  
  const kb = useVirtualKeyboard();

  const total = cart.reduce((s, i) => s + i.line_total, 0);
  const canPay = cart.length > 0 && total > 0;

  const openPay = (m: PaymentMethod) => {
    if (!canPay) return;
    setCreditName("");
    setCashReceived("");
    // Cash / M-Pesa / Card: complete and open print receipt immediately
    if (m === "cash" || m === "mpesa" || m === "card") {
      const sale = completeSale(m, { cashReceived: total });
      if (sale) setReceiptSale(sale);
      return;
    }
    setPayMethod(m); // credit still needs customer name
  };

  const confirmPay = () => {
    if (!payMethod) return;
    if (payMethod === "credit" && !creditName.trim()) return;
    const cashCents =
      payMethod === "cash"
        ? Math.round(parseFloat(cashReceived || "0") * 100)
        : total;
    if (payMethod === "cash" && cashCents < total) return;

    const sale = completeSale(payMethod, {
      creditCustomerName: creditName.trim() || undefined,
      cashReceived: cashCents,
    });
    setPayMethod(null);
    if (sale) setReceiptSale(sale);
  };

  return (
    <div className="flex h-full">
      {/* Products */}
      <ProductGrid />

      <div className="w-[22rem] sm:w-96 border-l border-[var(--border)] bg-[var(--bg-card)] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between text-[var(--text)]">
          <span className="font-bold text-[var(--text)]">Current Sale</span>
          <div className="flex gap-1" />

        </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!canPay}
              onClick={holdSale}
              className="py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold text-sm disabled:opacity-40"
            >
              Hold Sale
            </button>
            <button
              onClick={() => {
                if (cart.length === 0) return;
                if (window.confirm("Clear this sale? All items will be removed.")) clearCart();
              }}
              className="py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold text-sm"
            >
              Clear
            </button>
          </div>
        </div>

      {/* Payment modal */}
      {payMethod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-bold text-lg capitalize">{payMethod} Payment</h2>
              <button onClick={() => setPayMethod(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-center">
                <div className="text-sm text-slate-500">Total</div>
                <div className="text-3xl font-extrabold text-amber-600">{formatMoney(total)}</div>
              </div>

              {payMethod === "cash" && (
                <div>
                  <label className="text-sm font-medium">Cash received (KSh)</label>
                  <input
                    readOnly
                    value={cashReceived}
                    onClick={(e) => kb.openFor(cashReceived, setCashReceived, "numeric", e.currentTarget)}
                    placeholder="0.00"
                    className="mt-1 w-full text-2xl font-bold px-4 py-3 rounded-xl border-2 text-center cursor-pointer"
                  />
                  {cashReceived && Math.round(parseFloat(cashReceived) * 100) >= total && (
                    <div className="mt-2 flex justify-between text-sm bg-emerald-50 text-emerald-800 px-3 py-2 rounded-lg">
                      <span>Change</span>
                      <span className="font-bold">
                        {formatMoney(Math.round(parseFloat(cashReceived) * 100) - total)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {payMethod === "credit" && (
                <div>
                  <label className="text-sm font-medium">Customer name *</label>
                  <input
                    readOnly
                    value={creditName}
                    onClick={(e) => kb.openFor(creditName, setCreditName, "alpha", e.currentTarget)}
                    placeholder="Customer name"
                    className="mt-1 w-full px-4 py-3 rounded-xl border-2 cursor-pointer"
                  />
                </div>
              )}

              {(payMethod === "mpesa" || payMethod === "card") && (
                <p className="text-sm text-slate-500 text-center">
                  Confirm after customer pays via {payMethod === "mpesa" ? "M-Pesa STK" : "card terminal"}.
                </p>
              )}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setPayMethod(null)}
                className="flex-1 py-3 rounded-xl border-2 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={confirmPay}
                disabled={
                  (payMethod === "credit" && !creditName.trim()) ||
                  (payMethod === "cash" &&
                    (!cashReceived || Math.round(parseFloat(cashReceived || "0") * 100) < total))
                }
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold disabled:opacity-40"
              >
                Complete Sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt — auto-print then close */}
      {receiptSale && (
        <ThermalReceipt
          sale={receiptSale}
          settings={settings}
          onClose={() => {
            setReceiptSale(null);
            kb.close();
          }}
          autoPrint={false}
        />
      )}

      
      {showReturn && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl w-full max-w-md p-5 space-y-3 border border-[var(--border)]">
            <h3 className="font-bold text-[var(--text)]">Return product</h3>
            <select
              value={retPid}
              onChange={(e) => setRetPid(e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-[var(--border)] text-[var(--text)]"
            >
              <option value="">Select product</option>
              {allProducts.filter((p) => p.is_active !== false).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={retQty}
              onChange={(e) => setRetQty(e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-[var(--border)]"
              placeholder="Quantity"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold"
                onClick={() => {
                  const p = allProducts.find((x) => x.id === retPid);
                  const q = parseInt(retQty, 10);
                  if (!p || !q || q < 1) return;
                  returnProducts([{ product_id: p.id, product_name: p.name, quantity: q, unit_price: p.price }]);
                  setShowReturn(false);
                  setRetPid("");
                  setRetQty("1");
                }}
              >
                Confirm return
              </button>
              <button type="button" className="flex-1 py-3 rounded-xl border border-[var(--border)] font-semibold" onClick={() => setShowReturn(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

{/* Held sales */}
      {showHeld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b flex justify-between items-center">
              <h2 className="font-bold">Held Sales ({heldSales.length})</h2>
              <button onClick={() => setShowHeld(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {heldSales.length === 0 ? (
                <p className="text-center text-slate-400 py-8">No held sales</p>
              ) : (
                heldSales.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      loadHeldSale(h.id);
                      setShowHeld(false);
                    }}
                    className="w-full text-left p-3 rounded-xl border hover:border-amber-400 hover:bg-amber-50"
                  >
                    <div className="font-bold">{h.sale_number}</div>
                    <div className="text-sm text-slate-500">
                      {h.items.length} items · {formatMoney(h.total)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {kb.Keyboard}
    </div>
  );
}
