import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  parseISO, getHours, format, subDays
} from 'date-fns';
import {
  isCurrentBusinessDay,
  isInCurrentBusinessWeek,
  isInCurrentBusinessMonth,
} from '../utils/businessDay';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';

type Period = 'daily' | 'weekly' | 'monthly';
const COLORS = ['#0ea5e9', '#e94560', '#f5a623', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

export default function Reports() {
  const sales = useStore((s) => s.sales);
  const products = useStore((s) => s.products);
  const expenses = useStore((s) => s.expenses);
  const stockReceives = useStore((s) => s.stockReceives);
  const settings = useStore((s) => s.settings);
  const [period, setPeriod] = useState<Period>('daily');

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (s.is_credit_collection || s.payment_method === 'credit_collection') return false;
      if (!s.created_at) return false;
      if (period === 'daily') return isCurrentBusinessDay(s.created_at);
      if (period === 'weekly') return isInCurrentBusinessWeek(s.created_at);
      return isInCurrentBusinessMonth(s.created_at);
    });
  }, [sales, period]);

  // Last 7 days of product sales regardless of period filter (for day chart)
  const last7ProductSales = useMemo(() => {
    const cutoff = subDays(new Date(), 6);
    cutoff.setHours(0, 0, 0, 0);
    return sales.filter((s) => {
      if (s.is_credit_collection || s.payment_method === 'credit_collection') return false;
      return parseISO(s.created_at) >= cutoff;
    });
  }, [sales]);

  const totalSales = filteredSales.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const totalCost = filteredSales.reduce((s, x) => s + (Number(x.cost_total) || 0), 0);
  const profit = totalSales - totalCost;
  const margin = totalSales > 0 ? (profit / totalSales) * 100 : 0;
  const avgTicket = filteredSales.length ? totalSales / filteredSales.length : 0;
  const periodExpenses = expenses
    .filter((e) => {
      if (!e.created_at) return false;
      if (period === 'daily') return isCurrentBusinessDay(e.created_at);
      if (period === 'weekly') return isInCurrentBusinessWeek(e.created_at);
      return isInCurrentBusinessMonth(e.created_at);
    })
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Product stats
  const productStats: Record<string, { name: string; qty: number; revenue: number }> = {};
  filteredSales.forEach((s) => {
    s.items.forEach((it) => {
      if (it.product_id === '_discount' || it.price < 0) return;
      if (!productStats[it.product_id]) productStats[it.product_id] = { name: it.name, qty: 0, revenue: 0 };
      productStats[it.product_id].qty += it.qty;
      productStats[it.product_id].revenue += it.qty * it.price;
    });
  });
  const sortedByQty = Object.values(productStats).sort((a, b) => b.qty - a.qty);
  const best = sortedByQty[0];
  const worst = sortedByQty.length > 1 ? sortedByQty[sortedByQty.length - 1] : null;

  // Hourly — all 24 hours, compact
  const hourMap: Record<number, number> = {};
  filteredSales.forEach((s) => {
    const h = getHours(parseISO(s.created_at));
    hourMap[h] = (hourMap[h] || 0) + (Number(s.total) || 0);
  });
  const hourData = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0'),
    sales: hourMap[h] || 0,
  }));
  const busiestHour = hourData.reduce((a, b) => (b.sales > a.sales ? b : a), hourData[0]);

  // Sales by day (last 7 days for daily/weekly context, or month days)
  const dayMap: Record<string, number> = {};
  last7ProductSales.forEach((s) => {
    const key = format(parseISO(s.created_at), 'EEE dd');
    dayMap[key] = (dayMap[key] || 0) + (Number(s.total) || 0);
  });
  // Build ordered last 7 days
  const dayData = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(new Date(), 6 - i);
    const key = format(d, 'EEE dd');
    return { day: key, sales: dayMap[key] || 0 };
  });
  const busiestDay = dayData.reduce((a, b) => (b.sales > a.sales ? b : a), dayData[0]);

  // Category
  const catMap: Record<string, number> = {};
  filteredSales.forEach((s) => {
    s.items.forEach((it) => {
      if (it.product_id === '_discount' || it.price < 0) return;
      const p = products.find((x) => x.id === it.product_id);
      const cat = p?.category || 'other';
      catMap[cat] = (catMap[cat] || 0) + it.qty * it.price;
    });
  });
  const catData = Object.entries(catMap).map(([name, value]) => ({
    name: name.replace('_', ' '),
    value,
  }));

  // Most restocked proxy: products with highest current stock among those that sold (simple insight)
  // Better: use products sorted by stock desc as "most available / restocked"
  const restockMap: Record<string, { name: string; qty: number }> = {};
  stockReceives.forEach((r) => {
    if (!r.created_at) return;
    const inPeriod =
      period === 'daily'
        ? isCurrentBusinessDay(r.created_at)
        : period === 'weekly'
          ? isInCurrentBusinessWeek(r.created_at)
          : isInCurrentBusinessMonth(r.created_at);
    if (!inPeriod) return;
    if (!restockMap[r.product_id]) restockMap[r.product_id] = { name: r.product_name, qty: 0 };
    restockMap[r.product_id].qty += Number(r.quantity) || 0;
  });
  const mostRestocked = Object.values(restockMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const mostStocked = mostRestocked.length
    ? mostRestocked
    : [...products].sort((a, b) => b.stock - a.stock).slice(0, 5).map((p) => ({ name: p.name, qty: p.stock }));

  const byCashier = useMemo(() => {
    const map: Record<string, { name: string; total: number; tx: number }> = {};
    filteredSales.forEach((s) => {
      const key = s.cashier_id || s.cashier_name || 'unknown';
      if (!map[key]) map[key] = { name: s.cashier_name || key, total: 0, tx: 0 };
      map[key].total += Number(s.total) || 0;
      map[key].tx += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = filteredSales.map((s) => ({
      receipt: s.receipt_no,
      date: s.created_at,
      cashier: s.cashier_name || '',
      method: s.payment_method,
      total: s.total,
      cost: s.cost_total,
      credit_to: s.creditor_name || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sales');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        byCashier.map((c) => ({ cashier: c.name, transactions: c.tx, total: c.total }))
      ),
      'By cashier'
    );
    XLSX.writeFile(wb, `pos-report-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2 report-print-root">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex gap-2 flex-wrap">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize print:hidden ${
                period === p ? 'bg-primary-600 text-white' : 'bg-white border'
              }`}>
              {p}
            </button>
          ))}
          <button
            onClick={() => void exportExcel()}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-700 text-white print:hidden"
          >
            Export Excel
          </button>
          <button
            onClick={() => window.print()}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-800 text-white print:hidden"
          >
            Export / Print PDF
          </button>
        </div>
      </div>
      <style>{`
        @media print {
          nav, aside, header, .print\\:hidden { display: none !important; }
          body { background: white; }
          .report-print-root { display: block; }
        }
      `}</style>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Sales" value={`${settings.currency} ${totalSales.toFixed(0)}`} color="bg-sky-500" />
        <Kpi label="Profit" value={`${settings.currency} ${profit.toFixed(0)}`} color="bg-emerald-500" />
        <Kpi label="Margin" value={`${margin.toFixed(1)}%`} color="bg-violet-500" />
        <Kpi label="Avg Ticket" value={`${settings.currency} ${avgTicket.toFixed(0)}`} color="bg-amber-500" />
        <Kpi label="Transactions" value={String(filteredSales.length)} color="bg-rose-500" />
        <Kpi label="Expenses" value={`${settings.currency} ${periodExpenses.toFixed(0)}`} color="bg-orange-500" />
      </div>

      {byCashier.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow border">
          <h3 className="font-semibold mb-2">Cashier performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Cashier</th>
                  <th className="pb-2">Transactions</th>
                  <th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {byCashier.map((c) => (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td>{c.tx}</td>
                    <td className="font-semibold">
                      {settings.currency} {c.total.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Sales by Hour</h3>
            {busiestHour.sales > 0 && (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-medium">
                Busiest: {busiestHour.hour}:00 · {settings.currency} {busiestHour.sales.toFixed(0)}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={hourData}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip formatter={(v: number) => `${settings.currency} ${v}`} />
              <Area type="monotone" dataKey="sales" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-4 shadow border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Sales by Day (7 days)</h3>
            {busiestDay.sales > 0 && (
              <span className="text-xs bg-violet-100 text-violet-800 px-2 py-1 rounded-full font-medium">
                Busiest: {busiestDay.day} · {settings.currency} {busiestDay.sales.toFixed(0)}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dayData}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip formatter={(v: number) => `${settings.currency} ${v}`} />
              <Bar dataKey="sales" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border lg:col-span-1">
          <h3 className="font-semibold mb-2">By Category</h3>
          {catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name }) => name}>
                  {catData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `${settings.currency} ${v}`} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm py-8 text-center">—</p>
          )}
        </div>

      </div>


      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Best sellers */}
        <div className="bg-white rounded-xl p-4 shadow border">
          <h3 className="font-semibold mb-3">Best Selling</h3>
          {sortedByQty.length === 0 ? (
            <p className="text-gray-400 text-sm">—</p>
          ) : (
            <div className="space-y-2">
              {sortedByQty.slice(0, 6).map((p, i) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-gray-500">×{p.qty} · {settings.currency} {p.revenue.toFixed(0)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Insights */}
        <div className="bg-white rounded-xl p-4 shadow border">
          <h3 className="font-semibold mb-3">Insights</h3>
          <div className="space-y-3 text-sm">
            <div className="bg-emerald-50 rounded-lg p-3">
              <div className="text-xs text-emerald-600 font-medium">Top product</div>
              <div className="font-semibold">{best ? `${best.name} (×${best.qty})` : '—'}</div>
            </div>
            <div className="bg-rose-50 rounded-lg p-3">
              <div className="text-xs text-rose-600 font-medium">Slowest seller</div>
              <div className="font-semibold">{worst ? `${worst.name} (×${worst.qty})` : '—'}</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-xs text-amber-600 font-medium">Busiest hour</div>
              <div className="font-semibold">
                {busiestHour.sales > 0 ? `${busiestHour.hour}:00` : '—'}
              </div>
            </div>
            <div className="bg-violet-50 rounded-lg p-3">
              <div className="text-xs text-violet-600 font-medium">Busiest day</div>
              <div className="font-semibold">
                {busiestDay.sales > 0 ? busiestDay.day : '—'}
              </div>
            </div>
            <div className="bg-sky-50 rounded-lg p-3">
              <div className="text-xs text-sky-600 font-medium">Net after expenses</div>
              <div className="font-semibold">
                {settings.currency} {(profit - periodExpenses).toFixed(0)}
              </div>
            </div>
          </div>
        </div>

        {/* Stock levels / restock proxy */}
        <div className="bg-white rounded-xl p-4 shadow border">
          <h3 className="font-semibold mb-3">Most Restocked</h3>
          {mostStocked.length === 0 ? (
            <p className="text-gray-400 text-sm">—</p>
          ) : (
            <div className="space-y-2">
              {mostStocked.map((p, i) => (
                <div key={p.name + i} className="flex justify-between text-sm">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-gray-600 whitespace-nowrap ml-2">
                    +{p.qty}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top products bar */}
      {sortedByQty.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow border">
          <h3 className="font-semibold mb-3">Revenue by Product</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sortedByQty.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v: number) => `${settings.currency} ${v}`} />
              <Bar dataKey="revenue" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow border flex items-start gap-3">
      <div className={`w-3 h-3 rounded-full mt-1.5 ${color}`} />
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-bold text-gray-800">{value}</div>
      </div>
    </div>
  );
}
