import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { groupProductsByCategory, cn } from "@/lib/utils";
import { X, Bell } from "lucide-react";
import { useVirtualKeyboard, isMobileDevice } from "@/components/ui/VirtualKeyboard";
import { formatMoney } from "@/lib/utils";

export function ReceiveStockPage() {
  const products = useAppStore((s) => s.products);
  const suppliers = useAppStore((s) => s.suppliers);
  const receiveStock = useAppStore((s) => s.receiveStock);
  const stockReceives = useAppStore((s) => s.stockReceives);
  const session = useAppStore((s) => s.session)!;
  const markReceivesSeen = useAppStore((s) => s.markReceivesSeen);
  const groups = groupProductsByCategory(products);
  const isAdmin = session.role === "admin" || session.role === "manager";

  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const kb = useVirtualKeyboard();

  const product = products.find((p) => p.id === selected);

  const unseen = isAdmin
    ? stockReceives.filter((r) => !r.seen_by_admin && r.received_by !== session.id)
    : [];

  useEffect(() => {
    if (isAdmin && unseen.length > 0) {
      // keep banner until they dismiss by viewing; mark when leaving or button
    }
  }, [isAdmin, unseen.length]);

  const submit = () => {
    if (!selected || !qty || !totalCost) return;
    if (parseFloat(qty) <= 0 || parseFloat(totalCost) <= 0) return;
    try {
      receiveStock(
        selected,
        parseInt(qty, 10),
        Math.round(parseFloat(totalCost) * 100),
        supplier || undefined,
        receiptNo || undefined
      );
    } finally {
      setSelected(null);
      setQty("");
      setTotalCost("");
      setSupplier("");
      setReceiptNo("");
      kb.close();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] pb-16 md:pb-0">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h1 className="text-xl font-bold text-[var(--text)]">Receive Stock</h1>
      </div>

      {isAdmin && unseen.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-900/25 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-100">
              <Bell size={18} />
              Stock received by staff ({unseen.length})
            </div>
            <button
              type="button"
              onClick={() => markReceivesSeen()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white"
            >
              Mark all read
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {unseen.slice(0, 20).map((r) => (
              <div key={r.id} className="text-sm text-amber-950 dark:text-amber-50">
                <strong>{r.received_by_name}</strong> added {r.quantity} × {r.product_name}
                {r.supplier_name ? ` · ${r.supplier_name}` : ""} ·{" "}
                {new Date(r.created_at).toLocaleString()}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {groups.map((g) => (
          <div key={g.category} className="mb-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 border-b border-[var(--border)] pb-1">
              {g.label}
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
              {g.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelected(p.id);
                    setQty("");
                    setTotalCost("");
                    setSupplier("");
                    setReceiptNo("");
                  }}
                  className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden text-left hover:border-amber-400 active:scale-[0.97] transition touch-manipulation"
                >
                  <div className="aspect-square bg-[var(--bg-muted)] flex items-center justify-center relative">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl font-bold text-[var(--text-muted)]">
                        {p.name.charAt(0)}
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded",
                        p.stock_quantity <= 0 ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
                      )}
                    >
                      {p.stock_quantity}
                    </span>
                  </div>
                  <div className="p-2">
                    <div className="text-[10px] font-mono text-[var(--text-muted)]">{p.sku}</div>
                    <div className="font-semibold text-xs text-[var(--text)] line-clamp-2 leading-tight">
                      {p.name}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && product && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="bg-[var(--bg-card)] rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 space-y-3 border border-[var(--border)] max-h-[90vh] overflow-y-auto pb-8">
            <div className="flex justify-between items-start gap-2">
              <div className="flex gap-3">
                <div className="w-14 h-14 rounded-xl bg-[var(--bg-muted)] overflow-hidden shrink-0">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-[var(--text-muted)]">
                      {product.name[0]}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-[var(--text)]">{product.name}</h3>
                  <p className="text-xs font-mono text-[var(--text-muted)]">SKU {product.sku}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  kb.close();
                }}
              >
                <X size={22} className="text-[var(--text-muted)]" />
              </button>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text)]">
                Quantity{(product.units_per_pack || 1) > 1 ? ` (${product.pack_label || "packs"})` : ""} *
              </label>
              <input
                readOnly={!isMobileDevice()}
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(qty, setQty, "numeric", e.currentTarget);
                }}
                placeholder="0"
                className="mt-1 w-full px-3 py-3 rounded-xl cursor-pointer text-xl font-bold"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text)]">Total cost (KSh) *</label>
              <input
                readOnly={!isMobileDevice()}
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value.replace(/[^0-9.]/g, ""))}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(totalCost, setTotalCost, "numeric", e.currentTarget);
                }}
                placeholder="0.00"
                className="mt-1 w-full px-3 py-3 rounded-xl cursor-pointer text-xl font-bold"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text)]">Supplier (optional)</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="mt-1 w-full px-3 py-3 rounded-xl"
              >
                <option value="">— None —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--text)]">Receipt no. (optional)</label>
              <input
                readOnly={!isMobileDevice()}
                value={receiptNo}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(receiptNo, setReceiptNo, "alpha", e.currentTarget);
                }}
                placeholder="Optional"
                className="mt-1 w-full px-3 py-3 rounded-xl cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!qty || !totalCost}
              className="w-full py-3.5 rounded-xl bg-amber-500 text-white font-bold disabled:opacity-40 text-lg"
            >
              Receive stock
            </button>
          </div>
        </div>
      )}
      {kb.Keyboard}
    </div>
  );
}
