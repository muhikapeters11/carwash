import { useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney, isSameDay, isInCurrentBusinessDay } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";

export function ReportsPage() {
  const sales = useAppStore((s) => s.sales);
  const expenses = useAppStore((s) => s.expenses);
  const products = useAppStore((s) => s.products);
  const [period, setPeriod] = useState<Period>("daily");

  const inPeriod = (iso: string) => {
    const now = new Date();
    const d = new Date(iso);
    if (period === "daily") return isInCurrentBusinessDay(iso); // business day 08:00–08:00
    if (period === "weekly") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return d >= weekAgo && d <= now;
    }
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  };

  const filtered = useMemo(
    () => sales.filter((s) => s.status === "completed" && inPeriod(s.created_at)),
    [sales, period]
  );

  const expFiltered = useMemo(
    () => expenses.filter((e) => inPeriod(e.created_at)),
    [expenses, period]
  );

  const productSales = filtered.filter(
    (s) => !s.is_credit_payment && s.payment_method !== "credit"
  );
  const salesTotal =
    productSales.reduce((a, s) => a + s.total, 0) +
    filtered.filter((s) => s.is_credit_payment).reduce((a, s) => a + s.total, 0);
  const creditNew = filtered
    .filter((s) => !s.is_credit_payment && s.payment_method === "credit")
    .reduce((a, s) => a + s.total, 0);
  const creditPaid = filtered.filter((s) => s.is_credit_payment).reduce((a, s) => a + s.total, 0);
  const payCash = filtered.filter((s) => s.payment_method === "cash").reduce((a, s) => a + s.total, 0);
  const payMpesa = filtered.filter((s) => s.payment_method === "mpesa").reduce((a, s) => a + s.total, 0);
  const payCard = filtered.filter((s) => s.payment_method === "card").reduce((a, s) => a + s.total, 0);
  const expenseTotal = expFiltered.reduce((a, e) => a + e.amount, 0);
  const cogs = productSales.reduce((sum, sale) => {
    return (
      sum +
      sale.items.reduce((s, item) => {
        const p = products.find((pr) => pr.id === item.product_id);
        return s + (item.unit_cost ?? p?.cost ?? 0) * item.quantity;
      }, 0)
    );
  }, 0);
  const gross = productSales.reduce((a, s) => a + s.total, 0) - cogs;
  const net = gross - expenseTotal;

  // Best / worst from ALL active products (0 qty = worst candidates)
  const qtyMap: Record<string, number> = {};
  products
    .filter((p) => p.is_active)
    .forEach((p) => {
      qtyMap[p.name] = 0;
    });
  productSales.forEach((s) => {
    s.items.forEach((i) => {
      qtyMap[i.product_name] = (qtyMap[i.product_name] || 0) + i.quantity;
    });
  });
  const ranked = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]);
  const best = ranked.filter(([, q]) => q > 0).slice(0, 8);
  const worst = [...ranked].sort((a, b) => a[1] - b[1]).slice(0, 8);

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Reports</h1>
      <div className="flex gap-2 mb-6">
        {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize ${
              period === p
                ? "bg-amber-500 text-white"
                : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card label="Total sales" value={formatMoney(salesTotal)} />
        <Card label="Gross profit" value={formatMoney(gross)} />
        <Card label="Expenses" value={formatMoney(expenseTotal)} />
        <Card label="Net profit" value={formatMoney(net)} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Card label="Cash" value={formatMoney(payCash)} />
        <Card label="M-Pesa" value={formatMoney(payMpesa)} />
        <Card label="Card" value={formatMoney(payCard)} />
        <Card label="New credit" value={formatMoney(creditNew)} />
        <Card label="Credit paid" value={formatMoney(creditPaid)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <h2 className="font-bold mb-3 text-[var(--text)]">Best selling</h2>
          {best.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No sales in this period</p>
          ) : (
            best.map(([n, q], i) => (
              <div
                key={n}
                className="flex justify-between py-1.5 text-sm border-b border-[var(--border)] last:border-0 text-[var(--text)]"
              >
                <span>
                  <span className="text-[var(--text-muted)] mr-2">#{i + 1}</span>
                  {n}
                </span>
                <span className="font-semibold">{q} sold</span>
              </div>
            ))
          )}
        </section>
        <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <h2 className="font-bold mb-3 text-[var(--text)]">Worst selling</h2>
          {worst.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No products</p>
          ) : (
            worst.map(([n, q], i) => (
              <div
                key={n}
                className="flex justify-between py-1.5 text-sm border-b border-[var(--border)] last:border-0 text-[var(--text)]"
              >
                <span>
                  <span className="text-[var(--text-muted)] mr-2">#{i + 1}</span>
                  {n}
                </span>
                <span className="font-semibold">{q === 0 ? "0 sold" : `${q} sold`}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="text-lg font-extrabold mt-1 text-[var(--text)]">{value}</div>
    </div>
  );
}
