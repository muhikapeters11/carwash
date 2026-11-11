import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { parseISO, format, subDays } from 'date-fns';
import { TrendingUp, Package, AlertTriangle, Receipt, Printer, X, Banknote, CreditCard } from 'lucide-react';
import type { Sale } from '../types';
import { isCurrentBusinessDay, getBusinessDayStart, businessDayLabel } from '../utils/businessDay';

export default function Dashboard() {
  const currentUser = useStore((s) => s.currentUser)!;
  const sales = useStore((s) => s.sales);
  const products = useStore((s) => s.products);
  const expenses = useStore((s) => s.expenses);
  const settings = useStore((s) => s.settings);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const isAdmin = currentUser.role === 'admin';
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);

  const productSales = useMemo(
    () => sales.filter((s) => !s.is_credit_collection && s.payment_method !== 'credit_collection'),
    [sales]
  );

  const periodSales = useMemo(
    () => productSales.filter((s) => isCurrentBusinessDay(s.created_at)),
    [productSales]
  );

  const myPeriodSales = useMemo(
    () => periodSales.filter((s) => s.cashier_id === currentUser.id),
    [periodSales, currentUser.id]
  );

  // Cashier only sees current business day (resets conceptually at 09:00)
  // Admin sees current business day KPIs + previous days summary
  const salesToShow = isAdmin ? periodSales : myPeriodSales;

  const creditCollectionsPeriod = useMemo(
    () =>
      sales
        .filter(
          (s) =>
            (s.is_credit_collection || s.payment_method === 'credit_collection') &&
            isCurrentBusinessDay(s.created_at)
        )
        .reduce((sum, s) => sum + s.total, 0),
    [sales]
  );

  const grossSales = salesToShow.reduce((sum, s) => sum + s.total, 0);
  const totalCost = salesToShow.reduce((sum, s) => sum + s.cost_total, 0);
  const grossProfit = grossSales - totalCost;
  const periodExpenses = expenses
    .filter((e) => isCurrentBusinessDay(e.created_at))
    .reduce((sum, e) => sum + e.amount, 0);
  const netProfit = grossProfit - periodExpenses;
  const creditGiven = salesToShow
    .filter((s) => s.payment_method === 'credit')
    .reduce((sum, s) => sum + s.total, 0);
  const cashSales = salesToShow
    .filter((s) => s.payment_method === 'cash')
    .reduce((sum, s) => sum + s.total, 0);

  // Admin: previous calendar business days totals (last 7 business starts)
  const previousDays = useMemo(() => {
    if (!isAdmin) return [];
    const rows: { label: string; total: number; tx: number }[] = [];
    for (let i = 1; i <= 7; i++) {
      const ref = subDays(new Date(), i);
      // approximate: sales whose business-day start date matches
      const start = getBusinessDayStart(ref);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const daySales = productSales.filter((s) => {
        const t = parseISO(s.created_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      rows.push({
        label: format(start, 'EEE dd MMM'),
        total: daySales.reduce((a, s) => a + s.total, 0),
        tx: daySales.length,
      });
    }
    return rows;
  }, [isAdmin, productSales]);

  const productQty: Record<string, { name: string; qty: number }> = {};
  salesToShow.forEach((s) => {
    s.items.forEach((it) => {
      if (it.product_id === '_discount' || it.price < 0) return;
      if (!productQty[it.product_id]) productQty[it.product_id] = { name: it.name, qty: 0 };
      productQty[it.product_id].qty += it.qty;
    });
  });
  const topSellers = Object.values(productQty).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const lowStock = products.filter((p) => p.is_active !== false && p.stock <= p.low_stock_threshold);
  const last3Sales = salesToShow.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800">
          {isAdmin ? 'Dashboard' : 'My Sales'}
        </h1>
        <p className="text-xs text-gray-500" title="Business day window">
          Business day: {businessDayLabel()}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard title="Sales" value={`${settings.currency} ${grossSales.toFixed(0)}`} icon={<TrendingUp className="text-green-500" />} />
        <KpiCard title="Cash" value={`${settings.currency} ${cashSales.toFixed(0)}`} icon={<Banknote className="text-green-600" />} />
        <KpiCard title="Credit sales" value={`${settings.currency} ${creditGiven.toFixed(0)}`} icon={<CreditCard className="text-blue-600" />} />
        {isAdmin && (
          <>
            <KpiCard title="Gross Profit" value={`${settings.currency} ${grossProfit.toFixed(0)}`} icon={<TrendingUp className="text-blue-500" />} />
            <KpiCard title="Net Profit" value={`${settings.currency} ${netProfit.toFixed(0)}`} icon={<TrendingUp className="text-emerald-600" />} />
            <KpiCard title="Expenses" value={`${settings.currency} ${periodExpenses.toFixed(0)}`} icon={<Receipt className="text-orange-500" />} />
            <KpiCard title="Credit Collected" value={`${settings.currency} ${creditCollectionsPeriod.toFixed(0)}`} icon={<Receipt className="text-teal-500" />} />
          </>
        )}
        {!isAdmin && (
          <KpiCard title="Transactions" value={String(myPeriodSales.length)} icon={<Receipt className="text-blue-500" />} />
        )}
      </div>

      {isAdmin && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold mb-3">Previous Days</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Business day</th>
                  <th className="pb-2">Transactions</th>
                  <th className="pb-2">Total sales</th>
                </tr>
              </thead>
              <tbody>
                {previousDays.map((d) => (
                  <tr key={d.label} className="border-b last:border-0">
                    <td className="py-2">{d.label}</td>
                    <td>{d.tx}</td>
                    <td className="font-semibold">
                      {settings.currency} {d.total.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp size={18} /> Top sellers
          </h2>
          {topSellers.length === 0 ? (
            <p className="text-gray-400">—</p>
          ) : (
            <ol className="space-y-1.5">
              {topSellers.map((p, i) => (
                <li key={p.name} className="flex justify-between text-sm">
                  <span>
                    <span className="text-gray-400 mr-2">{i + 1}.</span>
                    <span className="font-medium">{p.name}</span>
                  </span>
                  <span className="font-bold">× {p.qty}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2 text-red-600">
            <AlertTriangle size={18} /> Low Stock
          </h2>
          {lowStock.length === 0 ? (
            <p className="text-gray-400">—</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {lowStock.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab('receive')}
                    className="w-full flex justify-between text-sm py-1 hover:bg-red-50 rounded px-1 text-left"
                    title="Open Receive Stock"
                  >
                    <span>{p.name}</span>
                    <span className="font-bold text-red-500">{p.stock}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-semibold mb-3">Items Sold</h2>
        {Object.keys(productQty).length === 0 ? (
          <p className="text-gray-400">—</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.values(productQty)
              .sort((a, b) => b.qty - a.qty)
              .map((p) => (
                <div key={p.name} className="bg-gray-50 rounded-lg px-3 py-2 text-sm flex justify-between">
                  <span className="truncate">{p.name}</span>
                  <span className="font-bold">{p.qty}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Printer size={18} /> Reprint
        </h2>
        {last3Sales.length === 0 ? (
          <p className="text-gray-400">—</p>
        ) : (
          <div className="space-y-2">
            {last3Sales.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div>
                  <span className="font-medium">{s.receipt_no}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {settings.currency} {s.total.toFixed(0)} · {s.payment_method}
                  </span>
                </div>
                <button
                  onClick={() => setReprintSale(s)}
                  className="text-sm px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 font-medium"
                >
                  Reprint
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {reprintSale && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 print:bg-white">
          <div className="bg-white rounded-xl shadow-2xl max-w-[320px] w-full p-5 receipt-thermal">
            <div className="text-center font-mono text-sm leading-relaxed">
              <div className="text-base font-bold uppercase">{settings.pub_name}</div>
              <div className="mt-1"><span className="font-bold italic">Till: {settings.till_number}</span></div>
              <div className="text-xs mt-1">Receipt: {reprintSale.receipt_no}</div>
              <div className="text-xs">{new Date(reprintSale.created_at).toLocaleString()}</div>
              <div className="text-xs">Cashier: {reprintSale.cashier_name || '—'}</div>
              <div className="border-t border-b border-dashed border-gray-400 my-3 py-2 space-y-1 text-left">
                {reprintSale.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="truncate">{it.name} x{it.qty}</span>
                    <span>{(it.price * it.qty).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-bold text-base">
                <span>TOTAL</span>
                <span>{settings.currency} {reprintSale.total.toFixed(0)}</span>
              </div>
              <div className="text-xs mt-1 capitalize">Payment: {reprintSale.payment_method}</div>
              <div className="text-xs mt-3 text-gray-600">{settings.receipt_footer}</div>
            </div>
            <div className="flex gap-2 mt-5 print:hidden">
              <button
                onClick={() => { window.print(); setReprintSale(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary-600 text-white rounded-xl font-semibold"
              >
                <Printer size={18} /> Print
              </button>
              <button onClick={() => setReprintSale(null)} className="flex-1 py-3 bg-gray-200 rounded-xl font-semibold">
                <X size={18} className="inline" /> Close
              </button>
            </div>
          </div>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .receipt-thermal, .receipt-thermal * { visibility: visible; }
              .receipt-thermal { position: absolute; left: 0; top: 0; width: 80mm; padding: 4mm; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-bold text-gray-800">{value}</div>
    </div>
  );
}
