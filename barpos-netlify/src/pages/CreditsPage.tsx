import { useState, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney, isInCurrentBusinessDay } from "@/lib/utils";
import type { PaymentMethod } from "@/types";
import { X, Bell } from "lucide-react";
import { useVirtualKeyboard } from "@/components/ui/VirtualKeyboard";

export function CreditsPage() {
  const session = useAppStore((s) => s.session)!;
  const settings = useAppStore((s) => s.settings);
  const credits = useAppStore((s) => s.credits);
  const sales = useAppStore((s) => s.sales);
  const payCredit = useAppStore((s) => s.payCredit);
  const isAdmin =
    session.role === "admin" || session.role === "manager" || session.role === "accountant";

  const list = isAdmin ? credits : credits.filter((c) => c.balance > 0);

  const recentPayments = useMemo(() => {
    const notes: { id: string; text: string; at: string }[] = [];
    credits.forEach((c) => {
      c.payments.forEach((p, i) => {
        if (isInCurrentBusinessDay(p.paid_at)) {
          notes.push({
            id: `${c.id}-${i}`,
            text: `${c.customer_name}: ${formatMoney(p.amount)} via ${p.method} by ${p.recorded_by}`,
            at: p.paid_at,
          });
        }
      });
    });
    return notes.sort((a, b) => b.at.localeCompare(a.at));
  }, [credits]);

  const [payId, setPayId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [wantPrint, setWantPrint] = useState(false);
  const [historySlip, setHistorySlip] = useState<null | import('@/types').Credit>(null);
  const [printSlip, setPrintSlip] = useState<null | { customer: string; amount: number; method: string; balance: number; by: string; at: string }>(null);
  const kb = useVirtualKeyboard();
  const credit = credits.find((c) => c.id === payId);

  const submit = () => {
    if (!payId || !amount || !credit) return;
    const payCents = Math.round(parseFloat(amount) * 100);
    const newBal = Math.max(0, credit.balance - payCents);
    payCredit(payId, payCents, method);
    if (wantPrint) {
      setPrintSlip({
        customer: credit.customer_name,
        amount: payCents,
        method,
        balance: newBal,
        by: session.full_name,
        at: new Date().toISOString(),
      });
    }
    setPayId(null);
    setAmount("");
    setWantPrint(false);
    kb.close();
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Credits</h1>

      {isAdmin && recentPayments.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4">
          <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-100 mb-2">
            <Bell size={18} />
            Credit payments today
          </div>
          <div className="space-y-1">
            {recentPayments.slice(0, 10).map((n) => (
              <div key={n.id} className="text-sm text-amber-900 dark:text-amber-100">
                {n.text}
                <span className="text-xs opacity-70 ml-2">
                  {new Date(n.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
        {list.length === 0 ? (
          <p className="p-6 text-[var(--text-muted)] text-sm">No credits</p>
        ) : (
          list.map((c) => (
            <div
              key={c.id}
              className="px-5 py-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <div className="font-bold text-[var(--text)]">{c.customer_name}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {c.cashier_name} · {new Date(c.created_at).toLocaleDateString()}
                  {c.balance <= 0 && " · ✓ CREDIT PAID"}
                </div>
                <div className="text-sm mt-1 text-[var(--text)]">
                  Original {formatMoney(c.original_amount)} · Paid {formatMoney(c.amount_paid)}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-bold ${
                    c.balance > 0 ? "text-purple-600" : "text-emerald-600"
                  }`}
                >
                  {c.balance > 0 ? `Balance ${formatMoney(c.balance)}` : "CREDIT PAID"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setHistorySlip(c)}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--text)]"
                  >
                    Print history
                  </button>
                  {c.balance > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPayId(c.id);
                        setAmount((c.balance / 100).toFixed(2));
                      }}
                      className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold"
                    >
                      Collect payment
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {payId && credit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl w-full max-w-sm p-5 space-y-3 border border-[var(--border)]">
            <div className="flex justify-between">
              <h3 className="font-bold text-[var(--text)]">Pay: {credit.customer_name}</h3>
              <button onClick={() => { setPayId(null); kb.close(); }}>
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Balance: {formatMoney(credit.balance)}
            </p>
            <div>
              <label className="text-sm font-medium text-[var(--text)]">Amount (KSh)</label>
              <input
                readOnly
                value={amount}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  kb.openFor(amount, setAmount, "numeric", e.currentTarget);
                }}
                className="mt-1 w-full px-3 py-3 rounded-xl cursor-pointer text-xl font-bold"
              />
            </div>
            <div className="flex gap-2">
              {(["cash", "mpesa", "card"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize border ${
                    method === m
                      ? "bg-amber-500 text-white border-amber-500"
                      : "border-[var(--border)] text-[var(--text)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
              <input type="checkbox" checked={wantPrint} onChange={(e) => setWantPrint(e.target.checked)} className="w-5 h-5" />
              Print payment slip (optional)
            </label>
            <button
              onClick={submit}
              className="w-full py-3 rounded-xl bg-purple-600 text-white font-bold"
            >
              Record payment
            </button>
          </div>
        </div>
      )}

      {historySlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white text-black rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3 border-b flex justify-between print:hidden">
              <h2 className="font-bold">Credit history</h2>
              <button type="button" onClick={() => setHistorySlip(null)}>✕</button>
            </div>
            <div
              className="thermal-receipt p-4 font-mono text-sm mx-auto"
              style={{ width: settings.thermal_width_mm === 58 ? "58mm" : "80mm", maxWidth: "100%" }}
            >
              <div className="text-center font-bold mb-1">{settings.business_name}</div>
              {settings.till_number ? (
                <div className="text-center text-xs italic mb-1">Till: {settings.till_number}</div>
              ) : null}
              <div className="text-center text-xs mb-2">CREDIT STATEMENT</div>
              <div className="mb-1">Customer: <strong>{historySlip.customer_name}</strong></div>
              <div>Original: {formatMoney(historySlip.original_amount)}</div>
              <div>Paid: {formatMoney(historySlip.amount_paid)}</div>
              <div className="font-bold">Balance: {formatMoney(historySlip.balance)}</div>
              <div className="border-t border-dashed border-black my-2" />
              <div className="text-xs font-bold mb-1">Products on credit</div>
              {sales
                .filter(
                  (s) =>
                    s.payment_method === "credit" &&
                    (s.credit_customer_name || "").toLowerCase() ===
                      historySlip.customer_name.toLowerCase()
                )
                .map((s) => (
                  <div key={s.id} className="mb-2 text-sm border-b border-black/20 pb-2">
                    <div className="font-semibold">Order {s.sale_number}</div>
                    {s.items.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span>
                          {it.quantity}× {it.product_name}
                        </span>
                        <span>{formatMoney(it.line_total)}</span>
                      </div>
                    ))}
                    <div className="text-xs opacity-70">
                      {new Date(s.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              <div className="text-xs font-bold mb-1 mt-2">Payments</div>
              {(historySlip.payments || []).length === 0 ? (
                <div className="text-xs">No partial payments yet</div>
              ) : (
                historySlip.payments.map((p, i) => (
                  <div key={i} className="text-xs flex justify-between mb-0.5">
                    <span>
                      {new Date(p.paid_at).toLocaleString()} · {p.method}
                    </span>
                    <span>{formatMoney(p.amount)}</span>
                  </div>
                ))
              )}
              <div className="text-center text-xs mt-6">{settings.receipt_footer || "Thank you"}</div>
            </div>
            <div className="px-5 pb-5 flex gap-2 print:hidden">
              <button
                type="button"
                className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold"
                onClick={() => {
                  const prev = document.title;
                  document.title = " ";
                  const close = () => { document.title = prev; setHistorySlip(null); };
                  window.addEventListener("afterprint", close, { once: true });
                  window.print();
                  setTimeout(close, 800);
                }}
              >
                Print ({settings.thermal_width_mm || 80}mm)
              </button>
              <button type="button" className="flex-1 py-3 rounded-xl border font-semibold" onClick={() => setHistorySlip(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {printSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white text-black rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-3 border-b flex justify-between print:hidden">
              <h2 className="font-bold">Payment slip</h2>
              <button onClick={() => setPrintSlip(null)} className="font-bold">✕</button>
            </div>
            <div className="thermal-receipt p-5 font-mono text-sm">
              <div className="text-center font-bold mb-2">CREDIT PAYMENT</div>
              <div className="text-center text-xs mb-3">{new Date(printSlip.at).toLocaleString()}</div>
              <div className="flex justify-between"><span>Customer</span><span>{printSlip.customer}</span></div>
              <div className="flex justify-between"><span>Paid</span><span>{formatMoney(printSlip.amount)}</span></div>
              <div className="flex justify-between capitalize"><span>Method</span><span>{printSlip.method}</span></div>
              <div className="flex justify-between font-bold mt-2"><span>Balance left</span><span>{formatMoney(printSlip.balance)}</span></div>
              <div className="text-center text-xs mt-4">Received by: {printSlip.by}</div>
            </div>
            <div className="px-5 pb-5 flex gap-2 print:hidden">
              <button
                onClick={() => {
                  const prev = document.title;
                  document.title = " ";
                  const close = () => {
                    document.title = prev;
                    setPrintSlip(null);
                  };
                  window.addEventListener("afterprint", close, { once: true });
                  window.print();
                  setTimeout(close, 800);
                }}
                className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold"
              >
                Print
              </button>
              <button onClick={() => setPrintSlip(null)} className="flex-1 py-3 rounded-xl border font-semibold">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {kb.Keyboard}
    </div>
  );
}
