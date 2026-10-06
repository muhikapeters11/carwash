import { useState, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { groupProductsByCategory, formatMoney, cn } from "@/lib/utils";
import { X } from "lucide-react";

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
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 bg-[var(--bg)]">
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
        <div key={g.category} className="mb-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            {g.label}
          </h2>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-muted)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold text-right">Qty</th>
                  {isAdmin && (
                    <>
                      <th className="px-3 py-2 font-semibold text-right">Unit cost</th>
                      <th className="px-3 py-2 font-semibold text-right">Sell price</th>
                      <th className="px-3 py-2 font-semibold text-right">Stock value (cost)</th>
                      <th className="px-3 py-2 font-semibold text-right">Stock value (sell)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {g.items.map((p) => {
                  const out = p.stock_quantity <= 0;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => {
                        setSelected(p.id);
                        setNewQty(String(p.stock_quantity));
                      }}
                      className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-amber-50 dark:hover:bg-slate-700/50"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-[var(--text-muted)]">
                        {p.sku}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-[var(--text)]">{p.name}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-bold",
                          out ? "text-red-500" : "text-emerald-600"
                        )}
                      >
                        {out ? "Out of stock" : p.stock_quantity}
                      </td>
                      {isAdmin && (
                        <>
                          <td className="px-3 py-2.5 text-right text-[var(--text)]">
                            {formatMoney(p.cost)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[var(--text)]">
                            {formatMoney(p.price)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[var(--text)]">
                            {formatMoney(p.cost * p.stock_quantity)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-amber-600 font-semibold">
                            {formatMoney(p.price * p.stock_quantity)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                type="number"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)] outline-none focus:border-amber-400"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--text)]">Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)] outline-none"
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
    </div>
  );
}
