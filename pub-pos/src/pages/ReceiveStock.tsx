import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { Category, Product } from '../types';
import NumericPad from '../components/NumericPad';
import QwertyKeyboard from '../components/QwertyKeyboard';
import { Layers } from 'lucide-react';
import ProductImage from '../components/ProductImage';

export default function ReceiveStock() {
  const products = useStore((s) => s.products);
  const updateProduct = useStore((s) => s.updateProduct);
  const addStockReceive = useStore((s) => s.addStockReceive);
  const stockReceives = useStore((s) => s.stockReceives);
  const logActivity = useStore((s) => s.logActivity);
  const currentUser = useStore((s) => s.currentUser)!;
  const addNotification = useStore((s) => s.addNotification);
  const settings = useStore((s) => s.settings);

  const [category, setCategory] = useState<Category | 'all'>('all');
  const [selected, setSelected] = useState<Product | null>(null);
  const [qty, setQty] = useState('');           // barrels if barrel product, else units
  const [totalCost, setTotalCost] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [activeKb, setActiveKb] = useState<'qty' | 'total' | 'receipt' | 'supplier' | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchItems, setBatchItems] = useState<{ product: Product; qty: string; totalCost: string }[]>([]);
  const [batchSelected, setBatchSelected] = useState<Product | null>(null);

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.is_active !== false);
    if (category !== 'all') list = list.filter((p) => p.category === category);
    return list.sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, category]);

  const recentSuppliers = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const r of stockReceives) {
      const s = (r.supplier || '').trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      names.push(s);
      if (names.length >= 8) break;
    }
    return names;
  }, [stockReceives]);

  const cupsPerBarrel = (p: Product) => p.barrel_cups || 100;

  const activeProduct = selected || batchSelected;
  const unitCostPreview = (() => {
    const q = parseFloat(qty);
    const t = parseFloat(totalCost);
    if (!activeProduct || !(q > 0) || t < 0) return '—';
    const units = activeProduct.is_barrel ? q * cupsPerBarrel(activeProduct) : q;
    return units > 0 ? (t / units).toFixed(2) : '—';
  })();

  const costWarning = (() => {
    if (!activeProduct || unitCostPreview === '—') return null;
    const uc = parseFloat(unitCostPreview);
    if (!Number.isFinite(uc) || activeProduct.cost <= 0) return null;
    if (uc > activeProduct.cost * 1.5) {
      return `Unit cost ${uc.toFixed(0)} is much higher than current avg ${activeProduct.cost.toFixed(0)}`;
    }
    return null;
  })();

  const applyReceive = (
    product: Product,
    qtyStr: string,
    totalStr: string,
    opts?: { receiptNo?: string; supplier?: string }
  ) => {
    const q = parseFloat(qtyStr);
    const total = parseFloat(totalStr);
    if (!Number.isFinite(q) || !Number.isFinite(total) || q <= 0 || total < 0) return false;
    const units = product.is_barrel ? q * cupsPerBarrel(product) : q;
    if (units <= 0) return false;
    const unitCost = total / units;
    const newStock = product.stock + units;
    const totalOldCost = product.cost * product.stock;
    const totalNewCost = unitCost * units;
    const newAvgCost = newStock > 0 ? (totalOldCost + totalNewCost) / newStock : unitCost;
    updateProduct(product.id, {
      stock: newStock,
      cost: Math.round(newAvgCost * 100) / 100,
    });
    addStockReceive({
      id: crypto.randomUUID(),
      product_id: product.id,
      product_name: product.name,
      quantity: units,
      barrels: product.is_barrel ? q : undefined,
      unit_cost: unitCost,
      total_cost: total,
      receipt_no: opts?.receiptNo?.trim() || undefined,
      supplier: opts?.supplier?.trim() || undefined,
      received_by: currentUser.id,
      received_by_name: currentUser.full_name,
      created_at: new Date().toISOString(),
    });
    logActivity(
      currentUser.id,
      currentUser.full_name,
      'Stock receive',
      `${product.name} +${units}${product.is_barrel ? ' cups' : ''}`
    );
    return true;
  };

  const submitReceive = () => {
    if (!selected || !qty || !totalCost) return;
    if (!applyReceive(selected, qty, totalCost, { receiptNo, supplier })) return;
    if (currentUser.role === 'cashier') {
      addNotification({
        title: 'Stock Received',
        message: `${currentUser.full_name} received ${qty}${selected.is_barrel ? ' barrel(s)' : ''} of ${selected.name}`,
        type: 'receive',
      });
    }
    setSelected(null);
    setQty('');
    setTotalCost('');
    setReceiptNo('');
    setSupplier('');
    setActiveKb(null);
  };

  const addToBatch = () => {
    if (!batchSelected || !qty || !totalCost) return;
    setBatchItems((prev) => [...prev, { product: batchSelected, qty, totalCost }]);
    setBatchSelected(null);
    setQty('');
    setTotalCost('');
    setActiveKb(null);
  };

  const submitBatch = () => {
    if (batchItems.length === 0) return;
    // Always use live product from store so repeated same-SKU lines update stock correctly
    batchItems.forEach((item) => {
      const live = useStore.getState().products.find((p) => p.id === item.product.id);
      if (live) applyReceive(live, item.qty, item.totalCost);
    });
    if (currentUser.role === 'cashier') {
      addNotification({
        title: 'Batch Receive',
        message: `${currentUser.full_name} received ${batchItems.length} product(s)`,
        type: 'receive',
      });
    }
    setBatchItems([]);
    setBatchMode(false);
    setQty('');
    setTotalCost('');
    setReceiptNo('');
    setSupplier('');
  };

  const catBtn = (c: string, active: boolean) =>
    `px-6 py-3 rounded-xl text-base font-semibold capitalize ${
      active ? 'bg-primary-600 text-white' : 'bg-white border text-gray-700'
    }`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Receive Stock</h1>
        <button
          onClick={() => { setBatchMode(!batchMode); setBatchItems([]); setSelected(null); setBatchSelected(null); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium ${
            batchMode ? 'bg-amber-500 text-white' : 'bg-white border'
          }`}
        >
          <Layers size={18} /> {batchMode ? 'Exit Batch' : 'Batch Receive'}
        </button>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        {(['all', 'beer', 'spirits', 'soft_drinks'] as const).map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={catBtn(c, category === c)}>
            {c === 'all' ? 'All' : c.replace('_', ' ')}
          </button>
        ))}
      </div>

      {batchMode && batchItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
          <div className="font-semibold mb-2">Batch ({batchItems.length} items)</div>
          <div className="space-y-1 max-h-24 overflow-y-auto text-sm">
            {batchItems.map((b, i) => (
              <div key={i} className="flex justify-between">
                <span>{b.product.name} × {b.qty}{b.product.is_barrel ? ' barrel(s)' : ''}</span>
                <span>{settings.currency} {b.totalCost}</span>
              </div>
            ))}
          </div>
          <button onClick={submitBatch} className="mt-2 w-full py-2.5 bg-green-600 text-white rounded-xl font-semibold">
            Receive All ({batchItems.length})
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 overflow-y-auto flex-1">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              if (batchMode) {
                setBatchSelected(p);
                setQty('');
                setTotalCost('');
              } else {
                setSelected(p);
                setQty('');
                setTotalCost('');
              }
            }}
            className="bg-white rounded-xl border shadow-sm p-2 text-left hover:shadow-md"
          >
            <div className="aspect-square bg-gray-100 rounded-lg mb-2 flex items-center justify-center text-3xl overflow-hidden">
              <ProductImage src={p.image_url} name={p.name} category={p.category} className="w-full h-full object-contain p-1" />
            </div>
            <div className="text-sm font-semibold truncate">{p.name}</div>
            <div className="text-xs text-gray-500">
              Stock: {p.stock}{p.is_barrel ? ' cups' : ''}
              {p.is_barrel && <span className="ml-1 text-amber-600">· Barrel</span>}
            </div>
          </button>
        ))}
      </div>

      {/* Single or batch item popup */}
      {(selected || batchSelected) && (() => {
        const prod = selected || batchSelected!;
        return (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-lg font-bold mb-1">{prod.name}</h2>
              <p className="text-sm text-gray-500 mb-1">
                Current: {prod.stock}{prod.is_barrel ? ' cups' : ''}
              </p>

              <div className="space-y-3">
                <button onClick={() => setActiveKb('qty')} className="w-full text-left border rounded-lg px-3 py-2.5 bg-gray-50">
                  <span className="text-xs text-gray-500">{prod.is_barrel ? 'Barrels *' : 'Quantity *'}</span>
                  <div className="font-semibold">{qty || ''}</div>
                </button>
                <button onClick={() => setActiveKb('total')} className="w-full text-left border rounded-lg px-3 py-2.5 bg-gray-50">
                  <span className="text-xs text-gray-500">Total Cost *</span>
                  <div className="font-semibold">{totalCost || ''}</div>
                </button>
                {prod.is_barrel && qty && (
                  <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                    +{parseFloat(qty || '0') * cupsPerBarrel(prod)} cups will be added
                  </div>
                )}
                {!batchMode && (
                  <>
                    <button onClick={() => setActiveKb('receipt')} className="w-full text-left border rounded-lg px-3 py-2.5 bg-gray-50">
                      <span className="text-xs text-gray-500">Receipt No</span>
                      <div>{receiptNo || '—'}</div>
                    </button>
                    <button onClick={() => setActiveKb('supplier')} className="w-full text-left border rounded-lg px-3 py-2.5 bg-gray-50">
                      <span className="text-xs text-gray-500">Supplier</span>
                      <div>{supplier || '—'}</div>
                    </button>
                    {recentSuppliers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {recentSuppliers.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setSupplier(s)}
                            className="px-2.5 py-1 rounded-full text-xs bg-gray-100 border"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {unitCostPreview !== '—' && (
                  <div className="text-sm text-gray-600">
                    Unit cost preview: <span className="font-semibold">{unitCostPreview}</span>
                    {activeProduct && (
                      <span className="text-gray-400 ml-2">
                        (stock {activeProduct.stock} → {activeProduct.stock + (activeProduct.is_barrel ? parseFloat(qty || '0') * cupsPerBarrel(activeProduct) : parseFloat(qty || '0') || 0)})
                      </span>
                    )}
                  </div>
                )}
                {costWarning && (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {costWarning}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  onClick={batchMode ? addToBatch : submitReceive}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-semibold"
                >
                  {batchMode ? 'Add to Batch' : 'Receive'}
                </button>
                <button
                  onClick={() => {
                    setSelected(null);
                    setBatchSelected(null);
                    setActiveKb(null);
                  }}
                  className="px-4 py-3 bg-gray-200 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {activeKb && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md">
            {activeKb === 'qty' || activeKb === 'total' ? (
              <div className="bg-gray-900 p-4 rounded-t-2xl">
                <NumericPad
                  value={activeKb === 'qty' ? qty : totalCost}
                  onChange={activeKb === 'qty' ? setQty : setTotalCost}
                  onConfirm={() => setActiveKb(null)}
                  large
                  allowDecimal
                />
              </div>
            ) : (
              <QwertyKeyboard
                value={activeKb === 'receipt' ? receiptNo : supplier}
                onChange={activeKb === 'receipt' ? setReceiptNo : setSupplier}
                onConfirm={() => setActiveKb(null)}
                onCancel={() => setActiveKb(null)}
                title={activeKb === 'receipt' ? 'Receipt Number' : 'Supplier'}
              />
            )}
          </div>
        </div>
      )}
    
      {/* Supplier / receive history */}
      <div className="bg-white rounded-xl shadow border p-4 mt-4">
        <h2 className="font-semibold mb-3">Recent receives & suppliers</h2>
        {stockReceives.length === 0 ? (
          <p className="text-gray-400 text-sm">—</p>
        ) : (
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-2">When</th>
                  <th className="pb-2 pr-2">Product</th>
                  <th className="pb-2 pr-2">Qty</th>
                  <th className="pb-2 pr-2">Total cost</th>
                  <th className="pb-2">By</th>
                </tr>
              </thead>
              <tbody>
                {stockReceives.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 whitespace-nowrap text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-2">{r.product_name}</td>
                    <td className="py-1.5 pr-2">{r.quantity}{r.barrels ? ` (${r.barrels} bbl)` : ''}</td>
                    <td className="py-1.5 pr-2">{settings.currency} {r.total_cost.toFixed(0)}</td>
                    <td className="py-1.5">{r.received_by_name || r.received_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
</div>
  );
}
