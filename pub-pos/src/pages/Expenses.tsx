import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import NativeField from '../components/NativeField';
import { Plus } from 'lucide-react';
import { isCurrentBusinessDay } from '../utils/businessDay';
import type { ExpenseCategory } from '../types';

const CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'utilities', label: 'Utilities' },
  { id: 'wages', label: 'Wages' },
  { id: 'stock', label: 'Stock' },
  { id: 'rent', label: 'Rent' },
  { id: 'transport', label: 'Transport' },
  { id: 'misc', label: 'Misc' },
];

export default function Expenses() {
  const expenses = useStore((s) => s.expenses);
  const addExpense = useStore((s) => s.addExpense);
  const logActivity = useStore((s) => s.logActivity);
  const currentUser = useStore((s) => s.currentUser)!;
  const settings = useStore((s) => s.settings);

  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('misc');
  const [note, setNote] = useState('');
  const [filterCat, setFilterCat] = useState<ExpenseCategory | 'all'>('all');
  const [kb, setKb] = useState<'desc' | 'amount' | 'note' | null>(null);

  const todayTotal = expenses
    .filter((e) => isCurrentBusinessDay(e.created_at))
    .reduce((s, e) => s + e.amount, 0);

  const list = useMemo(() => {
    let l = [...expenses];
    if (filterCat !== 'all') l = l.filter((e) => (e.category || 'misc') === filterCat);
    return l.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [expenses, filterCat]);

  const save = () => {
    if (!desc.trim() || !amount) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    addExpense({
      id: crypto.randomUUID(),
      description: desc.trim(),
      amount: Math.round(n * 100) / 100,
      category,
      note: note.trim() || undefined,
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
    });
    logActivity(currentUser.id, currentUser.full_name, 'Expense', `${desc.trim()} · ${n} · ${category}`);
    setDesc('');
    setAmount('');
    setNote('');
    setCategory('misc');
    setShowAdd(false);
    setKb(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-gray-500">
            Today: {settings.currency} {todayTotal.toFixed(0)}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg"
        >
          <Plus size={18} /> Add Expense
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCat('all')}
          className={`px-3 py-1.5 rounded-full text-sm ${filterCat === 'all' ? 'bg-primary-600 text-white' : 'bg-white border'}`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilterCat(c.id)}
            className={`px-3 py-1.5 rounded-full text-sm ${filterCat === c.id ? 'bg-primary-600 text-white' : 'bg-white border'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow divide-y">
        {list.length === 0 ? (
          <p className="p-8 text-center text-gray-400">—</p>
        ) : (
          list.slice(0, 100).map((e) => (
            <div key={e.id} className="px-4 py-3 flex justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{e.description}</div>
                <div className="text-xs text-gray-500">
                  {new Date(e.created_at).toLocaleString()}
                  {e.category && (
                    <span className="ml-2 capitalize px-1.5 py-0.5 bg-gray-100 rounded">
                      {e.category}
                    </span>
                  )}
                  {e.note && <span className="ml-2">· {e.note}</span>}
                </div>
              </div>
              <div className="font-bold shrink-0">
                {settings.currency} {e.amount.toFixed(0)}
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-4 space-y-3">
            <h2 className="font-bold text-lg">Add expense</h2>
            <NativeField
              label="Description"
              value={desc}
              onChange={setDesc}
              onFocusPad={() => setKb('desc')}
            />
            <NativeField
              label="Amount"
              value={amount}
              onChange={setAmount}
              inputMode="decimal"
              onFocusPad={() => setKb('amount')}
            />
            <div>
              <label className="text-sm text-gray-600">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full mt-1 border rounded-lg px-3 py-2"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <NativeField
              label="Note / receipt #"
              value={note}
              onChange={setNote}
              onFocusPad={() => setKb('note')}
            />
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 py-3 bg-primary-600 text-white rounded-xl font-semibold">
                Save
              </button>
              <button
                onClick={() => { setShowAdd(false); setKb(null); }}
                className="flex-1 py-3 bg-gray-200 rounded-xl font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
