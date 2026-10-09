import { useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney, isInCurrentBusinessDay } from "@/lib/utils";
import { Download } from "lucide-react";

type Period = "daily" | "weekly" | "monthly";

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage() {
  const sales = useAppStore((s) => s.sales);
  const expenses = useAppStore((s) => s.expenses);
  const products = useAppStore((s) => s.products);
  const settings = useAppStore((s) => s.settings);
  const [period, setPeriod] = useState<Period>("weekly");

  const inPeriod = (iso: string) => {
    const now = new Date();
    const d = new Date(iso);
    if (period === "daily") return isInCurrentBusinessDay(iso);
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
        return s + (p?.cost || 0) * item.quantity;
      }, 0)
    );
  }, 0);
  const gross = productSales.reduce((a, s) => a + s.total, 0) - cogs;
  const net = gross - expenseTotal;

  const qtyMap: Record<string, { qty: number; revenue: number; sku?: string }> = {};
  productSales.forEach((s) => {
    s.items.forEach((i) => {
      const key = i.product_name || i.product_id;
      if (!qtyMap[key]) qtyMap[key] = { qty: 0, revenue: 0, sku: undefined };
      qtyMap[key].qty += i.quantity;
      qtyMap[key].revenue += (i.unit_price || 0) * i.quantity;
    });
  });
  const ranked = Object.entries(qtyMap).sort((a, b) => b[1].qty - a[1].qty);
  const best = ranked.filter(([, v]) => v.qty > 0).slice(0, 8);

  const currency = settings?.currency_symbol || "KSh";
  const periodLabel = period === "daily" ? "today" : period === "weekly" ? "last-7-days" : "this-month";

  const downloadSalesCsv = () => {
    const header =
      "date,sale_number,cashier,payment_method,is_credit_payment,customer,subtotal,total,items_count\n";
    const rows = filtered
      .map((s) => {
        const itemsCount = (s.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
        return [
          s.created_at,
          s.sale_number || s.id,
          `"${(s.cashier_name || "").replace(/"/g, '""')}"`,
          s.payment_method || "",
          s.is_credit_payment ? "yes" : "no",
          `"${(s.credit_customer_name || "").replace(/"/g, '""')}"`,
          ((s.subtotal || 0) / 100).toFixed(2),
          ((s.total || 0) / 100).toFixed(2),
          itemsCount,
        ].join(",");
      })
      .join("\n");
    downloadText(`sales-${periodLabel}.csv`, header + rows);
  };

  const downloadProductsSoldCsv = () => {
    const header = "product_name,quantity_sold,revenue\n";
    const rows = ranked
      .map(
        ([name, v]) =>
          `"${name.replace(/"/g, '""')}",${v.qty},${(v.revenue / 100).toFixed(2)}`
      )
      .join("\n");
    downloadText(`products-sold-${periodLabel}.csv`, header + rows);
  };

  const downloadFullWeekly = () => {
    // Force last 7 days regardless of tab for the dedicated weekly download
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekSales = sales.filter(
      (s) =>
        s.status === "completed" &&
        new Date(s.created_at) >= weekAgo &&
        new Date(s.created_at) <= now
    );
    const lines: string[] = [];
    lines.push("=== WEEKLY SALES REPORT ===");
    lines.push(`Business,${settings?.business_name || "Bar POS"}`);
    lines.push(`From,${weekAgo.toISOString()}`);
    lines.push(`To,${now.toISOString()}`);
    lines.push("");
    lines.push("--- SALES ---");
    lines.push(
      "date,sale_number,cashier,payment_method,is_credit_payment,customer,total,item_product,item_qty,item_unit_price,item_line_total"
    );
    for (const s of weekSales) {
      const items = s.items || [];
      if (!items.length) {
        lines.push(
          [
            s.created_at,
            s.sale_number || s.id,
            `"${(s.cashier_name || "").replace(/"/g, '""')}"`,
            s.payment_method || "",
            s.is_credit_payment ? "yes" : "no",
            `"${(s.credit_customer_name || "").replace(/"/g, '""')}"`,
            ((s.total || 0) / 100).toFixed(2),
            "",
            "",
            "",
            "",
          ].join(",")
        );
      } else {
        for (const i of items) {
          lines.push(
            [
              s.created_at,
              s.sale_number || s.id,
              `"${(s.cashier_name || "").replace(/"/g, '""')}"`,
              s.payment_method || "",
              s.is_credit_payment ? "yes" : "no",
              `"${(s.credit_customer_name || "").replace(/"/g, '""')}"`,
              ((s.total || 0) / 100).toFixed(2),
              `"${(i.product_name || "").replace(/"/g, '""')}"`,
              i.quantity,
              ((i.unit_price || 0) / 100).toFixed(2),
              (((i.unit_price || 0) * (i.quantity || 0)) / 100).toFixed(2),
            ].join(",")
          );
        }
      }
    }
    lines.push("");
    lines.push("--- PRODUCTS SOLD SUMMARY ---");
    lines.push("product_name,quantity_sold,revenue");
    const map: Record<string, { qty: number; revenue: number }> = {};
    for (const s of weekSales) {
      if (s.is_credit_payment || s.payment_method === "credit") continue;
      for (const i of s.items || []) {
        const k = i.product_name || i.product_id;
        if (!map[k]) map[k] = { qty: 0, revenue: 0 };
        map[k].qty += i.quantity || 0;
        map[k].revenue += (i.unit_price || 0) * (i.quantity || 0);
      }
    }
    for (const [name, v] of Object.entries(map).sort((a, b) => b[1].qty - a[1].qty)) {
      lines.push(`"${name.replace(/"/g, '""')}",${v.qty},${(v.revenue / 100).toFixed(2)}`);
    }
    downloadText(`weekly-report-${now.toISOString().slice(0, 10)}.csv`, lines.join("\n"));
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 pb-24 md:pb-6 bg-[var(--bg)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-[var(--text)]">Reports</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadFullWeekly}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold"
          >
            <Download size={16} />
            Download weekly report
          </button>
          <button
            type="button"
            onClick={downloadSalesCsv}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text)]"
          >
            <Download size={16} />
            Sales CSV
          </button>
          <button
            type="button"
            onClick={downloadProductsSoldCsv}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text)]"
          >
            <Download size={16} />
            Products sold CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
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
        <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 sm:p-5">
          <h2 className="font-bold mb-3 text-[var(--text)]">Best selling</h2>
          {best.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No sales in this period</p>
          ) : (
            best.map(([n, v], i) => (
              <div
                key={n}
                className="flex justify-between py-1.5 text-sm border-b border-[var(--border)] last:border-0 text-[var(--text)]"
              >
                <span>
                  {i + 1}. {n}
                </span>
                <span className="font-semibold">
                  {v.qty} · {currency} {(v.revenue / 100).toFixed(0)}
                </span>
              </div>
            ))
          )}
        </section>
        <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 sm:p-5">
          <h2 className="font-bold mb-3 text-[var(--text)]">Period summary</h2>
          <p className="text-sm text-[var(--text-muted)] mb-2">
            {filtered.length} completed sale(s) in selected period.
          </p>
          <p className="text-sm text-[var(--text)]">
            Use <strong>Download weekly report</strong> for a full CSV of the last 7 days
            (every sale line + products sold totals).
          </p>
        </section>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-3 sm:p-4">
      <div className="text-xs text-[var(--text-muted)] mb-1">{label}</div>
      <div className="text-lg sm:text-xl font-bold text-[var(--text)] truncate">{value}</div>
    </div>
  );
}
