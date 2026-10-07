import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney, isInCurrentBusinessDay } from "@/lib/utils";
import { ThermalReceipt } from "@/components/ThermalReceipt";
import type { Sale } from "@/types";

export function DashboardPage() {
  const session = useAppStore((s) => s.session)!;
  const productReturns = useAppStore((s) => s.productReturns || []);
  const getTodaySales = useAppStore((s) => s.getTodaySales);
  const getYesterdaySales = useAppStore((s) => s.getYesterdaySales);
  const expenses = useAppStore((s) => s.expenses);
  const products = useAppStore((s) => s.products);
  const isCashier = session.role === "cashier";
  const allSales = useAppStore((s) => s.sales);
  const settings = useAppStore((s) => s.settings);
  const [saleQuery, setSaleQuery] = useState("");
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);

  const reprintMatches = saleQuery.trim()
    ? allSales.filter(
        (s) =>
          s.status === "completed" &&
          (session.role === "admin" ||
            session.role === "manager" ||
            s.cashier_id === session.id) &&
          (s.sale_number.toLowerCase().includes(saleQuery.trim().toLowerCase()) ||
            s.id.toLowerCase().includes(saleQuery.trim().toLowerCase()))
      ).slice(0, 15)
    : [];

  const todaySales = isCashier ? getTodaySales(session.id) : getTodaySales();
  const yesterdaySales = getYesterdaySales();
  const todayExpenses = expenses.filter((e) => isInCurrentBusinessDay(e.created_at));
  const expenseTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);

  // Product sales (not new credit accounts, not debt-payment-only lines counted as product sales)
  const productSales = todaySales.filter(
    (s) => !s.is_credit_payment && s.payment_method !== "credit"
  );
  const debtPaid = todaySales.filter((s) => s.is_credit_payment);
  const creditOpened = todaySales.filter(
    (s) => !s.is_credit_payment && s.payment_method === "credit"
  );

  // Total sales for the day = product sales + credit paid (money in)
  const productTotal = productSales.reduce((a, s) => a + s.total, 0);
  const debtPaidTotal = debtPaid.reduce((a, s) => a + s.total, 0);
  const totalSales = productTotal + debtPaidTotal;

  const cashIn =
    productSales.filter((s) => s.payment_method === "cash").reduce((a, s) => a + s.total, 0) +
    debtPaid.filter((s) => s.payment_method === "cash").reduce((a, s) => a + s.total, 0);
  const mpesaIn =
    productSales.filter((s) => s.payment_method === "mpesa").reduce((a, s) => a + s.total, 0) +
    debtPaid.filter((s) => s.payment_method === "mpesa").reduce((a, s) => a + s.total, 0);
  const cardIn =
    productSales.filter((s) => s.payment_method === "card").reduce((a, s) => a + s.total, 0) +
    debtPaid.filter((s) => s.payment_method === "card").reduce((a, s) => a + s.total, 0);

  const cogs = productSales.reduce((sum, sale) => {
    return (
      sum +
      sale.items.reduce((s, item) => {
        const p = products.find((pr) => pr.id === item.product_id);
        return s + (item.unit_cost ?? p?.cost ?? 0) * item.quantity;
      }, 0)
    );
  }, 0);
  const grossProfit = productTotal - cogs;
  const netProfit = grossProfit - expenseTotal;

  const itemsSold = productSales.reduce(
    (acc, sale) => {
      sale.items.forEach((i) => {
        acc[i.product_name] = (acc[i.product_name] || 0) + i.quantity;
      });
      return acc;
    },
    {} as Record<string, number>
  );

  const yesterdayTotal = yesterdaySales
    .filter((s) => !s.is_credit_payment && s.payment_method !== "credit")
    .reduce((s, x) => s + x.total, 0) +
    yesterdaySales.filter((s) => s.is_credit_payment).reduce((s, x) => s + x.total, 0);

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Dashboard</h1>
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat
          label={isCashier ? "My total sales" : "Total sales"}
          value={formatMoney(totalSales)}
          color="amber"
        />
        {!isCashier && (
          <>
            <Stat label="Yesterday's sales" value={formatMoney(yesterdayTotal)} color="slate" />
            <Stat label="Expenses" value={formatMoney(expenseTotal)} color="red" />
            <Stat
              label="Net profit"
              value={formatMoney(netProfit)}
              color={netProfit >= 0 ? "green" : "red"}
            />
          </>
        )}
        {isCashier && (
          <Stat
            label="Items sold"
            value={String(Object.values(itemsSold).reduce((a, b) => a + b, 0))}
            color="blue"
          />
        )}
      </div>

      {!isCashier && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Stat label="Cash" value={formatMoney(cashIn)} color="green" />
          <Stat label="M-Pesa" value={formatMoney(mpesaIn)} color="green" />
          <Stat label="Card" value={formatMoney(cardIn)} color="blue" />
          <Stat
            label="New credit issued"
            value={formatMoney(creditOpened.reduce((a, s) => a + s.total, 0))}
            color="purple"
          />
          <Stat label="Credit paid (in total sales)" value={formatMoney(debtPaidTotal)} color="amber" />
        </div>
      )}

      {isCashier && debtPaidTotal > 0 && (
        <div className="mb-6">
          <Stat label="Credit collected today (in my total)" value={formatMoney(debtPaidTotal)} color="amber" />
        </div>
      )}

      {!isCashier && (
        <section className="bg-[var(--bg-card)] rounded-2xl border border-amber-300 dark:border-amber-700 p-5 mb-6">
          <h2 className="font-bold text-[var(--text)] mb-3">Low stock alerts</h2>
          {products.filter((p) => p.is_active !== false && (p.min_stock ?? 0) > 0 && p.stock_quantity <= (p.min_stock ?? 0)).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">All good — no low stock</p>
          ) : (
            products
              .filter((p) => p.is_active !== false && (p.min_stock ?? 0) > 0 && p.stock_quantity <= (p.min_stock ?? 0))
              .map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-1 border-b border-[var(--border)] last:border-0 text-[var(--text)]">
                  <span>{p.name}</span>
                  <span className={p.stock_quantity <= 0 ? "text-red-500 font-bold" : "text-amber-600 font-bold"}>
                    {p.stock_quantity} / min {p.min_stock}
                  </span>
                </div>
              ))
          )}
        </section>
      )}

      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-6">
        <h2 className="font-bold text-[var(--text)] mb-3">Reprint receipt</h2>
        <p className="text-sm text-[var(--text-muted)] mb-2">Search by sale number</p>
        <input
          value={saleQuery}
          onChange={(e) => setSaleQuery(e.target.value)}
          placeholder="e.g. SALE-..."
          className="w-full px-3 py-3 rounded-xl border border-[var(--border)] mb-3"
        />
        {saleQuery.trim() && reprintMatches.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No matching sales</p>
        )}
        <div className="space-y-2">
          {reprintMatches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setReceiptSale(s)}
              className="w-full text-left px-3 py-3 rounded-xl border border-[var(--border)] hover:border-amber-400 touch-manipulation"
            >
              <div className="font-semibold text-[var(--text)]">{s.sale_number}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {new Date(s.created_at).toLocaleString()} · {formatMoney(s.total)} · {s.payment_method}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
        <h2 className="font-bold text-[var(--text)] mb-3">
          {isCashier ? "Products you sold today" : "Items sold today"}
        </h2>
        {Object.keys(itemsSold).length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No product sales yet</p>
        ) : (
          Object.entries(itemsSold)
            .sort((a, b) => b[1] - a[1])
            .map(([name, qty]) => (
              <div
                key={name}
                className="flex justify-between py-1.5 border-b border-[var(--border)] last:border-0 text-[var(--text)] text-sm"
              >
                <span>{name}</span>
                <span className="font-semibold">{qty}</span>
              </div>
            ))
        )}
      </section>

      {receiptSale && (
        <ThermalReceipt
          sale={receiptSale}
          settings={settings}
          onClose={() => setReceiptSale(null)}
          title="Reprint"
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    amber:
      "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800",
    green:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-800",
    red: "border-red-200 bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100 dark:border-red-800",
    blue: "border-blue-200 bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-800",
    purple:
      "border-purple-200 bg-purple-50 text-purple-900 dark:bg-purple-900/30 dark:text-purple-100 dark:border-purple-800",
    slate: "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)]",
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] || colors.slate}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
