import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { Product } from '../types';
import NumericPad from '../components/NumericPad';

export default function InventoryAudit() {
  const products = useStore((s) => s.products);
  const updateProduct = useStore((s) => s.updateProduct);
  const currentUser = useStore((s) => s.currentUser)!;
  const addNotification = useStore((s) => s.addNotification);
  const logActivity = useStore((s) => s.logActivity);
  const settings = useStore((s) => s.settings);
  const isAdmin = currentUser.role === 'admin';

  const [selected, setSelected] = useState<Product | null>(null);
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'beer' | 'spirits' | 'soft_drinks'>('all');
  const [sessionLog, setSessionLog] = useState<
    { name: string; prev: number; next: number; diff: number }[]
  >([]);

  const inventoryValueBefore = useMemo(
    () => products.reduce((sum, p) => sum + p.cost * p.stock, 0),
    [products]
  );
  const inventoryValueAfter = useMemo(
    () => products.reduce((sum, p) => sum + p.price * p.stock, 0),
    [products]
  );

  const visible = useMemo(() => {
    let list = products.filter((p) => p.is_active !== false);
    if (filter === 'low') list = list.filter((p) => p.stock <= p.low_stock_threshold);
    else if (filter !== 'all') list = list.filter((p) => p.category === filter);
    return list.sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, filter]);

  const submitAudit = () => {
    if (!selected || actual === '') return;
    const actualQty = parseFloat(actual);
    if (!Number.isFinite(actualQty) || actualQty < 0) return;
    const prevStock = selected.stock;
    const diff = actualQty - prevStock;

    updateProduct(selected.id, { stock: actualQty });

    const detail = `${selected.name}: ${prevStock} → ${actualQty}${reason.trim() ? ` (${reason.trim()})` : ''}`;
    addNotification({
      title: 'Inventory Audit',
      message: `${currentUser.full_name} audited ${detail}`,
      type: 'audit',
    });
    logActivity(currentUser.id, currentUser.full_name, 'Inventory audit', detail);
    setSessionLog((s) =>
      [{ name: selected.name, prev: prevStock, next: actualQty, diff }, ...s].slice(0, 40)
    );

    setSelected(null);
    setActual('');
    setReason('');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Inventory Audit</h1>

      {isAdmin && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="text-sm text-gray-500">At cost</div>
            <div className="text-xl font-bold">
              {settings.currency} {inventoryValueBefore.toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="text-sm text-gray-500">At sell price</div>
            <div className="text-xl font-bold">
              {settings.currency} {inventoryValueAfter.toFixed(0)}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All'],
          ['low', 'Low stock'],
          ['beer', 'Beer'],
          ['spirits', 'Spirits'],
          ['soft_drinks', 'Soft drinks'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-full text-sm ${filter === id ? 'bg-primary-600 text-white' : 'bg-white border'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {sessionLog.length > 0 && (
        <div className="bg-white rounded-xl border p-3 text-sm">
          <div className="font-semibold mb-2">This session variance</div>
          <ul className="space-y-1 max-h-28 overflow-y-auto">
            {sessionLog.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span
                  className={
                    r.diff === 0
                      ? 'text-gray-500'
                      : r.diff < 0
                        ? 'text-red-600 font-medium'
                        : 'text-green-700 font-medium'
                  }
                >
                  {r.prev} → {r.next} ({r.diff > 0 ? '+' : ''}
                  {r.diff})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {visible.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelected(p);
              setActual(String(p.stock));
              setReason('');
            }}
            className="bg-white rounded-xl border p-3 text-left hover:shadow"
          >
            <div className="font-semibold text-sm truncate">{p.name}</div>
            <div className="text-lg font-bold mt-1">{p.stock}</div>
            <div className="text-xs text-gray-400">{p.sku}</div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="font-bold text-lg mb-1">{selected.name}</h2>
            <p className="text-sm text-gray-500 mb-2">System stock: {selected.stock}</p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            />
            <div className="bg-gray-900 rounded-xl overflow-hidden">
              <NumericPad
                value={actual}
                onChange={setActual}
                onConfirm={submitAudit}
                large
                allowDecimal
              />
            </div>
            <button
              onClick={() => setSelected(null)}
              className="w-full mt-3 py-2 bg-gray-200 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
