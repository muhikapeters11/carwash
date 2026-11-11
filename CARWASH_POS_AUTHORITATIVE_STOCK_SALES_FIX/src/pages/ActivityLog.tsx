import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { isToday, isThisWeek, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

type Filter = 'all' | 'today' | 'week' | 'custom';

export default function ActivityLog() {
  const activityLogs = useStore((s) => s.activityLogs);
  const sales = useStore((s) => s.sales);
  const expenses = useStore((s) => s.expenses);
  const [filter, setFilter] = useState<Filter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [search, setSearch] = useState('');

  const derived = [
    ...sales.slice(0, 80).map((s) => ({
      id: `sale-${s.id}`,
      action: s.is_credit_collection || s.payment_method === 'credit_collection'
        ? 'Credit collection'
        : `Sale ${s.receipt_no}`,
      details: `${s.payment_method} · ${s.total} · ${s.cashier_name || s.cashier_id}`,
      user_name: s.cashier_name || '—',
      at: s.created_at,
    })),
    ...expenses.slice(0, 40).map((e) => {
      const staff = useStore.getState().staffUsers.find((u) => u.id === e.created_by);
      return {
        id: `exp-${e.id}`,
        action: 'Expense recorded',
        details: `${e.description} · ${e.amount}`,
        user_name: staff?.full_name || e.created_by,
        at: e.created_at,
      };
    }),
  ];

  const logs = [
    ...activityLogs.map((l) => ({
      id: l.id,
      action: l.action,
      details: l.details || '',
      user_name: l.user_name,
      at: l.created_at,
    })),
    ...derived,
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const seen = new Set<string>();
  const unique = logs.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });

  const users = useMemo(() => {
    const set = new Set(unique.map((l) => l.user_name).filter(Boolean));
    return Array.from(set).sort();
  }, [unique]);

  const filtered = unique.filter((l) => {
    const d = parseISO(l.at);
    if (userFilter !== 'all' && l.user_name !== userFilter) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${l.action} ${l.details} ${l.user_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter === 'today') return isToday(d);
    if (filter === 'week') return isThisWeek(d);
    if (filter === 'custom' && from && to) {
      return isWithinInterval(d, {
        start: startOfDay(new Date(from)),
        end: endOfDay(new Date(to)),
      });
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity Log</h1>
      

      <div className="flex flex-wrap gap-2 items-center">
        {(['all', 'today', 'week', 'custom'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize ${
              filter === f ? 'bg-primary-600 text-white' : 'bg-white border'
            }`}
          >
            {f}
          </button>
        ))}
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border text-sm bg-white"
        >
          <option value="all">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="px-3 py-2 rounded-xl border text-sm min-w-[140px]"
        />
        {filter === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow divide-y max-h-[65vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-gray-400">—</p>
        ) : (
          filtered.slice(0, 300).map((l) => (
            <div key={l.id} className="p-4 flex justify-between gap-4">
              <div>
                <div className="font-medium">{l.action}</div>
                <div className="text-sm text-gray-500">{l.details}</div>
                <div className="text-xs text-gray-400 mt-0.5">{l.user_name}</div>
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(l.at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
