import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney } from "@/lib/utils";
import { useVirtualKeyboard, isMobileDevice } from "@/components/ui/VirtualKeyboard";
import { Trash2 } from "lucide-react";

export function ExpensesPage() {
  const expenses = useAppStore((s) => s.expenses);
  const addExpense = useAppStore((s) => s.addExpense);
  const deleteExpense = useAppStore((s) => s.deleteExpense);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("");
  const kb = useVirtualKeyboard();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc || !amount) return;
    addExpense(desc, Math.round(parseFloat(amount) * 100), cat || undefined);
    setDesc("");
    setAmount("");
    setCat("");
    kb.close();
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 pb-24 md:pb-6 bg-[var(--bg)]">
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Expenses</h1>
      <form
        onSubmit={submit}
        className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-6 space-y-3 max-w-md"
      >
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Description *</label>
          <input
            readOnly={!isMobileDevice()}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(desc, setDesc, "alpha", e.currentTarget); }}
            placeholder="What was paid for"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Amount (KSh) *</label>
          <input
            readOnly={!isMobileDevice()}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(amount, setAmount, "numeric", e.currentTarget); }}
            placeholder="0.00"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Category</label>
          <input
            readOnly={!isMobileDevice()}
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            onPointerDown={(e) => {
                  if (isMobileDevice()) return;
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(cat, setCat, "alpha", e.currentTarget); }}
            placeholder="e.g. Utilities"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
          />
        </div>
        <button type="submit" className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold">
          Add expense
        </button>
      </form>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
        {expenses.length === 0 ? (
          <p className="p-6 text-[var(--text-muted)] text-sm">No expenses recorded</p>
        ) : (
          expenses.map((e) => (
            <div key={e.id} className="px-5 py-3 flex justify-between items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--text)]">{e.description}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {e.category ? `${e.category} · ` : ""}
                  {e.recorded_by_name} · {new Date(e.created_at).toLocaleString()}
                </div>
              </div>
              <div className="font-bold text-red-600 shrink-0">{formatMoney(e.amount)}</div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete expense "${e.description}"?`)) {
                    deleteExpense(e.id);
                  }
                }}
                className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 shrink-0"
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))
        )}
      </div>
      {kb.Keyboard}
    </div>
  );
}
