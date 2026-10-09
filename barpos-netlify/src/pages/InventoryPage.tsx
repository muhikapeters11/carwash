import { useState, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { groupProductsByCategory, formatMoney, cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useVirtualKeyboard, isMobileDevice } from "@/components/ui/VirtualKeyboard";

export function InventoryPage() {
  const products = useAppStore((s) => s.products);
  const auditStock = useAppStore((s) => s.auditStock);
  const stockAudits = useAppStore((s) => s.stockAudits);
  const session = useAppStore((s) => s.session)!;
  const markAuditsSeen = useAppStore((s) => s.markAuditsSeen);
  const isAdmin = session.role === "admin" || session.role === "manager" || session.role === "accountant";

  const groups = groupProductsByCategory(products);
  const [selected, setSelected] = useState<string | null>(null);
  const [newQty, setNewQty] = useState("");
  const [note, setNote] = useState("");
  const kb = useVirtualKeyboard();

  const product = products.find((p) => p.id === selected);

  const totals = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    const costValue = active.reduce((s, p) => s + p.cost * p.stock_quantity, 0);
    const sellValue = active.reduce((s, p) => s + p.price * p.stock_quantity, 0);
    return { costValue, sellValue, profit: sellValue - costValue };
  }, [products]);

  if (session.role === "admin") {
    const unseen = stockAudits.filter((a) => !a.seen_by_admin);
    if (unseen.length) markAuditsSeen();
  }

  const submit = () => {
    if (!selected || newQty === "") return;
    try {
      auditStock(selected, parseInt(newQty, 10), note || undefined);
    } finally {
      setSelected(null);
      setNewQty("");
      setNote("");
      kb.close();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 md:pb-4 bg-[var(--bg)]">
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Inventory Audit</h1>

      {/* Admin stock value summary */}
      {isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Total stock (cost / buying)</div>
            <div className="text-lg font-extrabold text-[var(--text)] mt-1">
              {formatMoney(totals.costValue)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Total if sold (selling price)</div>
            <div className="text-lg font-extrabold text-amber-600 mt-1">
              {formatMoney(totals.sellValue)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="text-xs text-[var(--text-muted)]">Potential profit</div>
            <div
              className={cn(
                "text-lg font-extrabold mt-1",
                totals.profit >= 0 ? "text-emerald-600" : "text-red-600"
              )}
            >
              {formatMoney(totals.profit)}
            </div>
          </div>
        </div>
      )}

      {session.role === "admin" && stockAudits.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-4 max-h-36 overflow-y-auto">
          <h2 className="font-semibold text-sm mb-2 text-[var(--text)]">Recent audits</h2>
          {stockAudits.slice(0, 15).map((a) => (
            <div
              key={a.id}
              className="text-xs flex justify-between py-1 border-b border-[var(--border)] last:border-0 text-[var(--text)]"
            >
              <span>
                {a.product_name}: {a.previous_qty} → {a.new_qty}{" "}
                <span className={a.difference >= 0 ? "text-emerald-600" : "text-red-600"}>
                  ({a.difference >= 0 ? "+" : ""}
                  {a.difference})
                </span>
              </span>
              <span className="text-[var(--text-muted)]">{a.audited_by_name}</span>
            </div>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.category} className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
            {g.label}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
            {g.items.map((p) => {
              const out = p.stock_quantity <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelected(p.id);
                    setNewQty(String(p.stock_quantity));
                  }}
                  className={cn(
                    "rounded-2xl border-2 bg-[var(--bg-card)] overflow-hidden text-left touch-manipulation active:scale-[0.98] transition min-h-[140px]",
                    out ? "border-red-300" : "border-[var(--border)] hover:border-amber-400"
                  )}
                >
                  <div className="aspect-square bg-[var(--bg-muted)] flex items-center justify-center overflow-hidden">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl font-bold text-[var(--text-muted)]">{p.name[0]}</span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className="font-semibold text-sm text-[var(--text)] line-clamp-2 leading-tight">{p.name}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">SKU {p.sku}</div>
                    <div className={cn("text-sm font-bold mt-1", out ? "text-red-500" : "text-emerald-600")}>
                      {out ? "Out of stock" : `Qty: ${p.stock_quantity}`}
                    </div>
                    {isAdmin && (
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {formatMoney(p.price)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {selected && product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl w-full max-w-sm p-5 space-y-3 border border-[var(--border)]">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-[var(--text)]">Audit: {product.name}</h3>
              <button onClick={() => setSelected(null)} className="text-[var(--text-muted)]">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              SKU {product.sku} · Current qty: {product.stock_quantity}
            </p>
            <div>
              <label className="text-sm font-medium text-[var(--text)]">New quantity</label>
              <input
                readOnly={!isMobileDevice()}
                value={newQty}
                onChange={(e) => setNewQty(e.target.value.replace(/[^0-9]/g, ""))}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(newQty, setNewQty, "numeric", e.currentTarget);
                }}
                className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] cursor-pointer text-xl font-bold"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--text)]">Note (optional)</label>
              <input
                readOnly={!isMobileDevice()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(note, setNote, "alpha", e.currentTarget);
                }}
                className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] cursor-pointer"
              />
            </div>
            <button
              onClick={submit}
              className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold"
            >
              Save Audit
            </button>
          </div>
        </div>
      )}
      {kb.Keyboard}
    </div>
  );
}
