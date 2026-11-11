import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import NumericPad from '../components/NumericPad';
import { ChevronDown, ChevronUp, Search, Printer } from 'lucide-react';
import { printReceipt } from '../lib/thermalPrint';
import type { Sale } from '../types';

function daysOutstanding(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export default function Credit() {
  const credits = useStore((s) => s.credits);
  const recordCreditPayment = useStore((s) => s.recordCreditPayment);
  const currentUser = useStore((s) => s.currentUser)!;
  const settings = useStore((s) => s.settings);
  const isAdmin = currentUser.role === 'admin';

  const [expanded, setExpanded] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const map: Record<string, { display: string; list: typeof credits }> = {};
    credits.forEach((c) => {
      const key = c.customer_name.trim().toLowerCase();
      if (!map[key]) map[key] = { display: c.customer_name.trim(), list: [] };
      map[key].list.push(c);
    });
    return Object.values(map)
      .map(({ display, list }) => ({
        name: display,
        totalRemaining: list.reduce((s, c) => s + c.remaining, 0),
        totalAmount: list.reduce((s, c) => s + c.amount, 0),
        oldestAt: list.reduce(
          (min, c) => (c.created_at < min ? c.created_at : min),
          list[0]?.created_at || new Date().toISOString()
        ),
        credits: list.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
      }))
      .sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [credits]);

  const submitPayment = async () => {
    if (!payingId || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Invalid amount');
      return;
    }
    const credit = credits.find((c) => c.id === payingId);
    if (credit && amount > credit.remaining + 0.001) {
      setError(`Max ${credit.remaining.toFixed(0)}`);
      return;
    }
    const r = recordCreditPayment(
      payingId,
      amount,
      currentUser.id,
      currentUser.full_name
    );
    if (!r.ok) {
      setError(r.error || 'Failed');
      return;
    }
    if (credit && r.paid) {
      const receiptSale: Sale = {
        id: crypto.randomUUID(),
        items: [
          {
            product_id: '_payment',
            name: `Credit payment · ${credit.customer_name}`,
            qty: 1,
            price: r.paid,
            cost: 0,
          },
        ],
        total: r.paid,
        cost_total: 0,
        payment_method: 'credit_collection',
        creditor_name: credit.customer_name,
        cashier_id: currentUser.id,
        cashier_name: currentUser.full_name,
        created_at: new Date().toISOString(),
        receipt_no: `P${Date.now().toString().slice(-8)}`,
        is_credit_collection: true,
      };
      try {
        await printReceipt(receiptSale, settings, true);
      } catch {
        /* ignore */
      }
    }
    setPayingId(null);
    setPayAmount('');
    setError('');
  };

  const q = search.trim().toLowerCase();
  const visibleGroups = (isAdmin
    ? grouped
    : grouped
        .filter((g) => g.totalRemaining > 0)
        .map((g) => ({
          ...g,
          credits: g.credits.filter((c) => c.remaining > 0),
        }))
  ).filter((g) => !q || g.name.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Credit</h1>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer…"
            className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm"
          />
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">—</div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((g) => (
            <div key={g.name} className="bg-white rounded-xl shadow border overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === g.name ? null : g.name)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
              >
                <div className="text-left">
                  <div className="font-semibold text-lg">{g.name}</div>
                  <div className="text-sm text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      Remaining:{' '}
                      <span className="font-bold text-red-600">
                        {settings.currency} {g.totalRemaining.toFixed(0)}
                      </span>
                    </span>
                    {g.totalRemaining > 0 && (
                      <span className="text-amber-700">
                        {daysOutstanding(g.oldestAt)}d outstanding
                      </span>
                    )}
                  </div>
                </div>
                {expanded === g.name ? <ChevronUp /> : <ChevronDown />}
              </button>

              {expanded === g.name && (
                <div className="border-t px-4 pb-4 space-y-3">
                  {g.credits.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 rounded-lg p-3"
                    >
                      <div>
                        <div className="font-medium">
                          {settings.currency} {c.remaining.toFixed(0)}
                          <span className="text-gray-400 text-sm font-normal ml-2">
                            of {c.amount.toFixed(0)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(c.created_at).toLocaleString()} · {daysOutstanding(c.created_at)}d
                        </div>
                      </div>
                      {c.remaining > 0 && (
                        <button
                          onClick={() => {
                            setPayingId(c.id);
                            setPayAmount(String(c.remaining));
                            setError('');
                          }}
                          className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"
                        >
                          Collect
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {payingId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-4 space-y-3">
            <h2 className="font-bold text-lg">Record payment</h2>
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <Printer size={14} /> A receipt will open after payment
            </p>
            <NumericPad
              value={payAmount}
              onChange={setPayAmount}
              onConfirm={submitPayment}
              maxLength={10}
              allowDecimal
              large
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              onClick={() => {
                setPayingId(null);
                setError('');
              }}
              className="w-full py-2 text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
