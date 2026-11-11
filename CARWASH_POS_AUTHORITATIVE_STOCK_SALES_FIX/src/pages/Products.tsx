import React, { useState, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Product, Category } from '../types';
import { Plus, Upload, Download, Pencil } from 'lucide-react';
import * as XLSX from 'xlsx';
import QwertyKeyboard from '../components/QwertyKeyboard';
import NumericPad from '../components/NumericPad';

const emptyForm = {
  name: '', sku: '', category: 'beer' as Category, price: '', cost: '', stock: '',
  low_stock_threshold: '10', is_barrel: false, barrel_cups: '100', image_url: '', is_active: true,
};

export default function Products() {
  const products = useStore((s) => s.products);
  const addProduct = useStore((s) => s.addProduct);
  const updateProduct = useStore((s) => s.updateProduct);
  const deleteProduct = useStore((s) => s.deleteProduct);
  const logActivity = useStore((s) => s.logActivity);
  const currentUser = useStore((s) => s.currentUser);
  const settings = useStore((s) => s.settings);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [kbType, setKbType] = useState<'qwerty' | 'numeric'>('qwerty');
  const [filterCat, setFilterCat] = useState<Category | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const openField = (field: string, type: 'qwerty' | 'numeric') => {
    setActiveField(field);
    setKbType(type);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm({
      name: p.name, sku: p.sku, category: p.category,
      price: String(p.price), cost: String(p.cost), stock: String(p.stock),
      low_stock_threshold: String(p.low_stock_threshold),
      is_barrel: p.is_barrel, barrel_cups: String(p.barrel_cups || 100),
      image_url: p.image_url || '', is_active: p.is_active !== false,
    });
    setShowForm(true);
  };

  const saveProduct = () => {
    if (!form.name.trim() || !form.sku.trim() || !form.price) return;
    const price = parseFloat(form.price);
    const cost = parseFloat(form.cost || '0');
    const stock = parseFloat(form.stock || '0');
    const low = parseFloat(form.low_stock_threshold || '10');
    if (!Number.isFinite(price) || price < 0) return;
    if (!Number.isFinite(cost) || cost < 0) return;
    if (!Number.isFinite(stock) || stock < 0) return;
    const data = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category,
      price,
      cost,
      stock,
      low_stock_threshold: Number.isFinite(low) && low >= 0 ? low : 10,
      is_barrel: form.is_barrel,
      barrel_cups: form.is_barrel ? parseInt(form.barrel_cups, 10) || 100 : undefined,
      image_url: form.image_url || undefined,
      is_active: form.is_active,
    };
    if (editingId) {
      const r = updateProduct(editingId, data);
      if (!r.ok) { alert(r.error || 'Update failed'); return; }
    } else {
      const r = addProduct({ id: crypto.randomUUID(), ...data });
      if (!r.ok) { alert(r.error || 'Add failed'); return; }
    }
    setForm(emptyForm); setEditingId(null); setShowForm(false);
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Compress product photos before local persistence/cloud sync. Large raw
      // camera images were exceeding browser storage and never reaching cloud.
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image processing unavailable');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      let quality = 0.78;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > 180_000 && quality > 0.42) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > 220_000) throw new Error('Please choose a smaller product photo.');
      setForm((f) => ({ ...f, image_url: dataUrl }));
    } catch (err: any) {
      alert(err?.message || 'Could not process this image. Try another photo.');
    }
  };

  const exportXlsx = () => {
    const data = products.map((p) => ({
      sku: p.sku, name: p.name, category: p.category, price: p.price, cost: p.cost,
      stock: p.stock, low_stock_threshold: p.low_stock_threshold,
      is_barrel: p.is_barrel, barrel_cups: p.barrel_cups || '', is_active: p.is_active !== false,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, 'products.xlsx');
  };

  const importXlsx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      const imported: Product[] = rows.map((r) => ({
        id: crypto.randomUUID(),
        sku: String(r.sku || ''), name: String(r.name || ''),
        category: (r.category as Category) || 'beer',
        price: Number(r.price) || 0, cost: Number(r.cost) || 0, stock: Number(r.stock) || 0,
        low_stock_threshold: Number(r.low_stock_threshold) || 10,
        is_barrel: Boolean(r.is_barrel), barrel_cups: r.barrel_cups ? Number(r.barrel_cups) : 100,
        is_active: r.is_active !== false && r.is_active !== 'false',
      }));
      const existingSkus = new Set(products.map((p) => p.sku.toLowerCase()));
      const fresh = imported.filter(
        (p) => p.sku && p.name && !existingSkus.has(p.sku.toLowerCase())
      );
      if (fresh.length < imported.length) {
        alert(`Imported ${fresh.length} of ${imported.length} (skipped duplicate SKUs)`);
      }
      let added = 0;
      for (const product of fresh) {
        const result = addProduct(product);
        if (result.ok) added += 1;
      }
      if (added !== fresh.length) alert(`Saved ${added} of ${fresh.length} imported products.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const [search, setSearch] = React.useState('');

  const list = useMemo(() => {
    let l = [...products];
    if (filterCat !== 'all') l = l.filter((p) => p.category === filterCat);
    const q = search.trim().toLowerCase();
    if (q) {
      l = l.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      );
    }
    return l.sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, filterCat, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Products</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => fileRef.current?.click()} className="px-3 py-2 bg-white border rounded-lg text-sm">Import</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importXlsx} />
          <button onClick={exportXlsx} className="px-3 py-2 bg-white border rounded-lg text-sm">Export</button>
          <button onClick={() => { setEditingId(null); setForm(emptyForm); setShowForm(true); }}
            className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {(['all', 'beer', 'spirits', 'soft_drinks'] as const).map((c) => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold capitalize ${filterCat === c ? 'bg-primary-600 text-white' : 'bg-white border'}`}>
            {c === 'all' ? 'All' : c.replace('_', ' ')}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or SKU…"
          className="ml-auto px-3 py-2 border rounded-xl text-sm min-w-[180px]"
        />
      </div>

      {/* List form */}
      <div className="bg-white rounded-xl shadow border overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={list.length > 0 && list.every((p) => selectedIds.includes(p.id))}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(list.map((p) => p.id));
                    else setSelectedIds([]);
                  }}
                />
              </th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={(e) => {
                      setSelectedIds((ids) =>
                        e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)
                      );
                    }}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 capitalize">{p.category.replace('_', ' ')}</td>
                <td className="px-4 py-3">{settings.currency} {p.price}</td>
                <td className="px-4 py-3 text-gray-500">{settings.currency} {p.cost}</td>
                <td className="px-4 py-3">{p.stock}{p.is_barrel ? ' cups' : ''}</td>
                <td className="px-4 py-3">{p.is_barrel ? `Barrel (${p.barrel_cups || 100})` : 'Unit'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => updateProduct(p.id, { is_active: p.is_active === false })}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold ${p.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                  >
                    {p.is_active !== false ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(p)} className="flex items-center gap-1 text-primary-600 text-sm font-medium">
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete ${p.name}?`)) {
                          deleteProduct(p.id);
                          if (currentUser) logActivity(currentUser.id, currentUser.full_name, 'Product deleted', p.name);
                        }
                      }}
                      className="text-red-600 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">—</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold mb-4">{editingId ? 'Edit Product' : 'Add Product'}</h2>
            <div className="space-y-3">
              <Field label="Name *" value={form.name} onClick={() => openField('name', 'qwerty')} />
              <Field label="SKU *" value={form.sku} onClick={() => openField('sku', 'qwerty')} />
              <div>
                <label className="text-sm text-gray-600">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                  className="w-full mt-1 border rounded-lg px-3 py-2">
                  <option value="beer">Beer</option>
                  <option value="spirits">Spirits</option>
                  <option value="soft_drinks">Soft Drinks</option>
                </select>
              </div>
              <Field label="Selling Price *" value={form.price} onClick={() => openField('price', 'numeric')} />
              <Field label="Cost Price" value={form.cost} onClick={() => openField('cost', 'numeric')} />
              <Field label="Stock" value={form.stock} onClick={() => openField('stock', 'numeric')} />
              <Field label="Low Stock Threshold" value={form.low_stock_threshold} onClick={() => openField('low_stock_threshold', 'numeric')} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_barrel} onChange={(e) => setForm({ ...form, is_barrel: e.target.checked })} className="w-5 h-5" />
                <span>Barrel product (1 barrel = cups below)</span>
              </label>
              {form.is_barrel && (
                <Field label="Cups per Barrel" value={form.barrel_cups} onClick={() => openField('barrel_cups', 'numeric')} />
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-5 h-5" />
                <span>Active (sellable)</span>
              </label>
              <div>
                <label className="text-sm text-gray-600">Image</label>
                <div className="mt-1 flex items-center gap-3">
                  {form.image_url && <img src={form.image_url} className="w-16 h-16 object-cover rounded-lg" />}
                  <button onClick={() => imgRef.current?.click()} className="px-3 py-2 border rounded-lg text-sm">Upload</button>
                  <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={saveProduct} className="flex-1 py-3 bg-primary-600 text-white rounded-xl font-semibold">Save</button>
              <button onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }} className="px-4 py-3 bg-gray-200 rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {activeField && (
        <div className="fixed inset-0 z-50">
          {kbType === 'qwerty' ? (
            <QwertyKeyboard value={(form as any)[activeField] || ''} onChange={(v) => setForm({ ...form, [activeField]: v })} onConfirm={() => setActiveField(null)} onCancel={() => setActiveField(null)} title={activeField} />
          ) : (
            <div className="fixed inset-0 bg-black/60 flex items-end justify-center">
              <div className="w-full max-w-md bg-gray-900 p-4 rounded-t-2xl">
                <NumericPad value={(form as any)[activeField] || ''} onChange={(v) => setForm({ ...form, [activeField]: v })} onConfirm={() => setActiveField(null)} large allowDecimal={['price','cost','stock','low_stock_threshold'].includes(activeField)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <div>
      <label className="text-sm text-gray-600">{label}</label>
      <button onClick={onClick} className="w-full mt-1 text-left border rounded-lg px-3 py-2.5 bg-gray-50 hover:bg-gray-100 min-h-[42px]">
        {value || <span className="text-gray-400"></span>}
      </button>
    </div>
  );
}
