import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney } from "@/lib/utils";
import type { PaymentMethod, Sale } from "@/types";
import { Minus, Plus, Trash2, Pause, Eraser, X } from "lucide-react";
import { useVirtualKeyboard } from "@/components/ui/VirtualKeyboard";
import { ProductGrid } from "@/components/sell/ProductGrid";

export function SellPage() {
  const cart = useAppStore((s) => s.cart);
  const heldSales = useAppStore((s) => s.heldSales);
  const updateCartQty = useAppStore((s) => s.updateCartQty);
  const clearCart = useAppStore((s) => s.clearCart);
  const holdSale = useAppStore((s) => s.holdSale);
  const loadHeldSale = useAppStore((s) => s.loadHeldSale);
  const completeSale = useAppStore((s) => s.completeSale);
  const settings = useAppStore((s) => s.settings);
  const session = useAppStore((s) => s.session);
  const sales = useAppStore((s) => s.sales);
  const lastSale = sales.find((s) => s.status === "completed" && s.cashier_id === session?.id)
    || sales.find((s) => s.status === "completed");

  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [creditName, setCreditName] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [showReprint, setShowReprint] = useState(false);
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
          <div className="flex gap-1">
            <button
              onClick={() => setShowReprint(true)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 text-xs font-semibold"
              title="Reprint"
            >
              Reprint
            </button>
            <button
              onClick={() => setShowHeld(true)}
              className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              title="Held sales"
            >
              <Pause size={18} />
              {heldSales.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {heldSales.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                if (cart.length === 0) return;
                if (window.confirm("Clear this sale? All items will be removed.")) clearCart();
              }}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              title="Clear"
            >
              <Eraser size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <p className="text-center text-slate-400 mt-8 text-sm">Tap products to add</p>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{item.product_name}</div>
                  <div className="text-xs text-amber-600 font-semibold">
                    {formatMoney(item.line_total)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateCartQty(item.id, item.quantity - 1)}
                    className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                  <button
                    onClick={() => updateCartQty(item.id, item.quantity + 1)}
                    className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => updateCartQty(item.id, 0)}
                    className="w-8 h-8 rounded-lg text-red-500 flex items-center justify-center"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border)] p-4 space-y-3">
          <div className="flex justify-between text-xl font-extrabold text-[var(--text)]">
            <span>Total</span>
            <span className="text-amber-600">{formatMoney(total)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!canPay}
              onClick={() => openPay("cash")}
              className="py-4 min-h-[56px] rounded-2xl bg-emerald-500 text-white font-bold text-sm disabled:opacity-40"
            >
              Cash
            </button>
            <button
              disabled={!canPay}
              onClick={() => openPay("mpesa")}
              className="py-4 min-h-[56px] rounded-2xl bg-green-600 text-white font-bold text-sm disabled:opacity-40"
            >
              M-Pesa
            </button>
            <button
              disabled={!canPay}
              onClick={() => openPay("card")}
              className="py-4 min-h-[56px] rounded-2xl bg-blue-600 text-white font-bold text-sm disabled:opacity-40"
            >
              Card
            </button>
            <button
              disabled={!canPay}
              onClick={() => openPay("credit")}
              className="py-4 min-h-[56px] rounded-2xl bg-purple-600 text-white font-bold text-sm disabled:opacity-40"
            >
              Credit
            </button>
          </div>

          {lastSale && (
            <button
              type="button"
              onClick={() => setReceiptSale(lastSale)}
              className="w-full mb-2 py-3 min-h-[48px] rounded-xl border-2 border-amber-400 text-amber-800 dark:text-amber-200 font-bold text-sm touch-manipulation"
            >
              Reprint last sale · {lastSale.sale_number}
            </button>
          )}

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
                    onClick={() => kb.openFor(cashReceived, setCashReceived, "numeric")}
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
                    onClick={() => kb.openFor(creditName, setCreditName, "alpha")}
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

      {/* Receipt */}
      {receiptSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:bg-white print:p-0">
          <div className="bg-white text-black rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden print:shadow-none print:rounded-none">
            <div className="px-5 py-3 border-b flex justify-between items-center print:hidden">
              <h2 className="font-bold text-slate-900">Receipt</h2>
              <button onClick={() => { setReceiptSale(null); kb.close(); }} className="p-2 hover:bg-slate-100 rounded-lg text-slate-700">
                <X size={20} />
              </button>
            </div>
            <div
              className="thermal-receipt px-5 pt-6 pb-8 font-mono text-sm text-black bg-white"
              style={{ width: settings.thermal_width_mm === 58 ? "58mm" : "80mm", maxWidth: "100%", margin: "0 auto" }}
            >
              <div className="text-center font-bold text-base uppercase tracking-wide mb-1">
                {settings.business_name || "My Bar"}
              </div>
              {settings.till_number ? (
                <div className="text-center text-sm font-bold italic mb-1">
                  Till No: {settings.till_number}
                </div>
              ) : null}
              <div className="text-center text-xs mb-1">
                {new Date(receiptSale.created_at).toLocaleString()}
              </div>
              <div className="text-center text-xs mb-1">
                Served by: {receiptSale.cashier_name}
              </div>
              <div className="border-t border-dashed border-black my-3" />
              {receiptSale.items.length > 0 ? (
                receiptSale.items.map((i) => (
                  <div key={i.id} className="flex justify-between text-xs mb-1">
                    <span className="pr-2">{i.quantity}x {i.product_name}</span>
                    <span className="whitespace-nowrap">{formatMoney(i.line_total)}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-center mb-1">Credit payment</div>
              )}
              <div className="border-t border-dashed border-black my-3" />
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL</span>
                <span>{formatMoney(receiptSale.total)}</span>
              </div>
              <div className="flex justify-between text-xs capitalize mt-1">
                <span>{receiptSale.payment_method}</span>
                <span>
                  {receiptSale.payment_method === "credit"
                    ? receiptSale.credit_customer_name
                    : formatMoney(receiptSale.amount_paid)}
                </span>
              </div>
              {receiptSale.change_given > 0 && (
                <div className="flex justify-between text-xs mt-1">
                  <span>Change</span>
                  <span>{formatMoney(receiptSale.change_given)}</span>
                </div>
              )}
              <div className="text-center text-xs mt-10 pt-4">
                {settings.receipt_footer || "Thank you for your business!"}
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2 print:hidden">
              <button
                onClick={() => {
                  const prev = document.title;
                  document.title = " ";
                  const close = () => {
                    document.title = prev;
                    setReceiptSale(null);
                  };
                  window.addEventListener("afterprint", close, { once: true });
                  window.print();
                  // Fallback if afterprint does not fire (some WebViews)
                  setTimeout(close, 800);
                }}
                className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold"
              >
                Print
              </button>
              <button
                onClick={() => setReceiptSale(null)}
                className="flex-1 py-3 rounded-xl border-2 border-slate-300 font-semibold text-slate-800"
              >
                Done
              </button>
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

      {showReprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b flex justify-between items-center">
              <h2 className="font-bold">Reprint receipt</h2>
              <button onClick={() => setShowReprint(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sales.filter((s) => s.status === "completed" && (session?.role === "admin" || s.cashier_id === session?.id)).slice(0, 40).length === 0 ? (
                <p className="text-center text-slate-400 py-8">No sales to reprint</p>
              ) : (
                sales
                  .filter((s) => s.status === "completed" && (session?.role === "admin" || s.cashier_id === session?.id))
                  .slice(0, 40)
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setReceiptSale(s);
                        setShowReprint(false);
                      }}
                      className="w-full text-left p-3 rounded-xl border hover:border-amber-400"
                    >
                      <div className="font-bold text-sm">{s.sale_number}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(s.created_at).toLocaleString()} · {formatMoney(s.total)} · {s.payment_method}
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
