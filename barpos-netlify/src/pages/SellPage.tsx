import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney } from "@/lib/utils";
import type { PaymentMethod, Sale } from "@/types";
import { Minus, Plus, Trash2, Pause, X } from "lucide-react";
import { useVirtualKeyboard, isMobileDevice } from "@/components/ui/VirtualKeyboard";
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
  const allProducts = useAppStore((s) => s.products);
  const kb = useVirtualKeyboard();

  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [creditName, setCreditName] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [retPid, setRetPid] = useState("");
  const [retQty, setRetQty] = useState("1");

  const total = cart.reduce((s, i) => s + i.line_total, 0);
  const canPay = cart.length > 0 && total > 0;

  const openPay = (m: PaymentMethod) => {
    if (!canPay) return;
    setCreditName("");
    setCashReceived("");
    if (m === "cash" || m === "mpesa" || m === "card") {
      const sale = completeSale(m, { cashReceived: total });
      if (sale) setReceiptSale(sale);
      return;
    }
    setPayMethod(m);
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
    kb.close();
    if (sale) setReceiptSale(sale);
  };

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-hidden order-1 md:order-1">
        <ProductGrid />
      </div>

      <div className="order-2 md:order-2 w-full md:w-[22rem] lg:w-96 max-h-[48%] md:max-h-none h-[48%] md:h-full border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--bg-card)] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between text-[var(--text)]">
          <span className="font-bold text-[var(--text)]">Current Sale</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setShowReturn(true)}
              className="px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-600 text-xs font-semibold"
            >
              Return
            </button>
            <button
              type="button"
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] py-12 text-sm">
              Tap products to add
            </p>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-xl bg-[var(--bg-muted)] border border-[var(--border)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--text)] truncate">
                    {item.product_name}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {formatMoney(item.unit_price)} each
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.id, item.quantity - 1)}
                    className="w-9 h-9 rounded-lg bg-white border border-[var(--border)] flex items-center justify-center"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-8 text-center font-bold text-[var(--text)]">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.id, item.quantity + 1)}
                    className="w-9 h-9 rounded-lg bg-white border border-[var(--border)] flex items-center justify-center"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="w-16 text-right font-bold text-sm text-[var(--text)]">
                  {formatMoney(item.line_total)}
                </div>
                <button
                  type="button"
                  onClick={() => updateCartQty(item.id, 0)}
                  className="p-1.5 text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-[var(--border)] space-y-2">
          <div className="flex justify-between items-center px-1">
            <span className="font-semibold text-[var(--text)]">Total</span>
            <span className="text-2xl font-extrabold text-amber-600">
              {formatMoney(total)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!canPay}
              onClick={() => holdSale()}
              className="py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold text-sm disabled:opacity-40"
            >
              Hold Sale
            </button>
            <button
              type="button"
              onClick={() => {
                if (cart.length === 0) return;
                if (window.confirm("Clear this sale? All items will be removed."))
                  clearCart();
              }}
              className="py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 font-semibold text-sm"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["cash", "mpesa", "card", "credit"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!canPay}
                onClick={() => openPay(m)}
                className={`py-3 rounded-xl font-bold text-sm capitalize disabled:opacity-40 ${
                  m === "credit"
                    ? "bg-purple-600 text-white"
                    : "bg-amber-500 text-white"
                }`}
              >
                {m === "mpesa" ? "M-Pesa" : m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Credit payment modal */}
      {payMethod === "credit" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl w-full max-w-md p-5 space-y-3 border border-[var(--border)]">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-lg text-[var(--text)]">Credit sale</h2>
              <button type="button" onClick={() => { setPayMethod(null); kb.close(); }}>
                <X size={20} />
              </button>
            </div>
            <div className="text-center text-2xl font-extrabold text-amber-600">
              {formatMoney(total)}
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--text)]">
                Customer name *
              </label>
              <input
                readOnly={!isMobileDevice()}
                value={creditName}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(creditName, setCreditName, "alpha", e.currentTarget);
                }}
                placeholder="Customer name"
                className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] cursor-pointer text-[var(--text)]"
              />
            </div>
            <button
              type="button"
              disabled={!creditName.trim()}
              onClick={confirmPay}
              className="w-full py-3 rounded-xl bg-purple-600 text-white font-bold disabled:opacity-40"
            >
              Complete credit sale
            </button>
          </div>
        </div>
      )}

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
              {allProducts
                .filter((p) => p.is_active !== false)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
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
                  returnProducts([
                    {
                      product_id: p.id,
                      product_name: p.name,
                      quantity: q,
                      unit_price: p.price,
                    },
                  ]);
                  setShowReturn(false);
                  setRetPid("");
                  setRetQty("1");
                }}
              >
                Confirm return
              </button>
              <button
                type="button"
                className="flex-1 py-3 rounded-xl border border-[var(--border)] font-semibold"
                onClick={() => setShowReturn(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showHeld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b flex justify-between items-center">
              <h2 className="font-bold">Held Sales ({heldSales.length})</h2>
              <button
                type="button"
                onClick={() => setShowHeld(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
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
                    type="button"
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
