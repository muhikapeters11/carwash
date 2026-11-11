import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { Category, Sale, CartItem } from '../types';
import QwertyKeyboard from '../components/QwertyKeyboard';
import NumericPad from '../components/NumericPad';
import { Printer, Pause, CreditCard, Banknote, ScanBarcode, RotateCcw, Trash2 } from 'lucide-react';
import { printReceipt } from '../lib/thermalPrint';
import ProductImage from '../components/ProductImage';

const CATEGORIES: { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'beer', label: 'Beer' },
  { id: 'spirits', label: 'Spirits' },
  { id: 'soft_drinks', label: 'Soft Drinks' },
];

function holdTimeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export default function Sell() {
  const products = useStore((s) => s.products);
  const cart = useStore((s) => s.cart);
  const addToCart = useStore((s) => s.addToCart);
  const updateCartQty = useStore((s) => s.updateCartQty);
  const clearCart = useStore((s) => s.clearCart);
  const completeSaleFromCartAsync = useStore((s) => s.completeSaleFromCartAsync);
  const holdSale = useStore((s) => s.holdSale);
  const heldSales = useStore((s) => s.heldSales);
  const resumeHeldSale = useStore((s) => s.resumeHeldSale);
  const removeHeldSale = useStore((s) => s.removeHeldSale);
  const credits = useStore((s) => s.credits);
  const currentUser = useStore((s) => s.currentUser)!;
  const settings = useStore((s) => s.settings);

  const [category, setCategory] = useState<Category | 'all'>('all');
  const [showCreditKeyboard, setShowCreditKeyboard] = useState(false);
  const [creditorName, setCreditorName] = useState('');
  const [showHoldKeyboard, setShowHoldKeyboard] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [lastHoldCustomer, setLastHoldCustomer] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastCartSnapshot, setLastCartSnapshot] = useState<CartItem[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Keep barcode field focused for scanners
  useEffect(() => {
    const t = window.setTimeout(() => barcodeRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const recentCreditors = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of credits) {
      const key = c.customer_name.trim().toLowerCase();
      if (!names.has(key)) names.set(key, c.customer_name.trim());
    }
    return Array.from(names.values()).slice(0, 12);
  }, [credits]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.is_active !== false);
    if (category !== 'all') list = list.filter((p) => p.category === category);
    return list.sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, category]);

  const priceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.id, p.price);
    return m;
  }, [products]);

  const cartTotal = useMemo(() => {
    let sum = 0;
    for (const c of cart) {
      sum += (priceById.get(c.product.id) ?? c.product.price) * c.quantity;
    }
    return sum;
  }, [cart, priceById]);

  const scanBarcode = (code: string) => {
    const q = code.trim();
    if (!q) return;
    const match = products.find(
      (p) =>
        p.is_active !== false &&
        (p.sku.toLowerCase() === q.toLowerCase() || p.name.toLowerCase() === q.toLowerCase())
    );
    if (!match) {
      flash(`No product for: ${q}`);
      setBarcode('');
      return;
    }
    const r = addToCart(match.id);
    if (!r.ok) flash(r.error || 'Cannot add');
    else flash(`Added ${match.name}`);
    setBarcode('');
  };

  const runSale = async (method: 'cash' | 'credit', name?: string) => {
    if (submitting || cart.length === 0) return;
    setSubmitting(true);
    setLastCartSnapshot(cart.map((c) => ({ product: { ...c.product }, quantity: c.quantity })));
    try {
      const result = await completeSaleFromCartAsync({
        method,
        creditorName: name,
        cashierId: currentUser.id,
        cashierName: currentUser.full_name,
      });
      if (!result.ok || !result.sale) {
        flash(result.error || 'Sale failed');
        return;
      }
      setLastSale(result.sale);
      setShowCreditKeyboard(false);
      setCreditorName('');
      setLastHoldCustomer(null);
      setShowPrintPreview(true);
    } finally {
      setSubmitting(false);
      window.setTimeout(() => barcodeRef.current?.focus(), 80);
    }
  };

  const handleCash = () => {
    if (cart.length === 0 || submitting) return;
    runSale('cash');
  };

  const repeatLastSale = () => {
    if (!lastCartSnapshot?.length) {
      flash('No previous sale to repeat');
      return;
    }
    if (cart.length > 0) {
      flash('Clear cart before repeating last sale');
      return;
    }
    for (const item of lastCartSnapshot) {
      const r = addToCart(item.product.id, item.quantity);
      if (!r.ok) {
        flash(r.error || `Cannot add ${item.product.name}`);
        break;
      }
    }
  };

  const handleCreditConfirm = () => {
    if (!creditorName.trim()) return;
    runSale('credit', creditorName.trim());
  };

  const handleHoldClick = () => {
    if (cart.length === 0) return;
    if (lastHoldCustomer) {
      holdSale(lastHoldCustomer);
      setLastHoldCustomer(null);
      
      flash('Sale held');
    } else {
      setShowHoldKeyboard(true);
    }
  };

  const handleHoldConfirm = () => {
    if (!holdName.trim()) return;
    holdSale(holdName.trim());
    setLastHoldCustomer(null);
    setShowHoldKeyboard(false);
    setHoldName('');
    
    flash('Sale held');
  };

  const handleResume = (id: string, customerName: string) => {
    const r = resumeHeldSale(id);
    if (!r.ok) {
      flash(r.error || 'Cannot resume');
      return;
    }
    setLastHoldCustomer(customerName);
  };

  const doPrint = async () => {
    if (lastSale) {
      await printReceipt(lastSale, settings, true);
    } else {
      window.print();
    }
    setShowPrintPreview(false);
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-4">
      {/* Products left (order-1), Cart right (order-2) on desktop */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] bg-gray-900 text-white px-4 py-2 rounded-xl shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 order-1">
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-6 py-3 rounded-xl text-base font-semibold ${
                category === c.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border'
              }`}
            >
              {c.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2 min-w-[220px]">
            <ScanBarcode size={20} className="text-gray-400 shrink-0" />
            <input
              ref={barcodeRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  scanBarcode(barcode);
                }
              }}
              placeholder="SKU"
              className="flex-1 outline-none text-sm bg-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 overflow-y-auto flex-1 pb-4">
          {filtered.map((p) => {
            const isLow = p.stock <= p.low_stock_threshold;
            return (
              <button
                key={p.id}
                onClick={() => {
                  const r = addToCart(p.id);
                  if (!r.ok) flash(r.error || 'Cannot add');
                }}
                disabled={p.stock <= 0}
                className="relative bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow overflow-hidden flex flex-col disabled:opacity-50 min-h-[220px]"
              >
                <div
                  className={`absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full text-xs font-bold text-white ${
                    isLow ? 'bg-red-500' : 'bg-green-500'
                  }`}
                >
                  {p.stock}
                </div>
                <div className="flex-1 min-h-[140px] bg-gray-50 flex items-center justify-center overflow-hidden">
                  <ProductImage src={p.image_url} name={p.name} category={p.category} className="w-full h-full object-contain p-2" />
                </div>
                <div className="p-3 text-left border-t bg-white">
                  <div className="text-sm font-semibold truncate leading-tight">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.sku}</div>
                  <div className="text-primary-600 font-bold text-base mt-0.5">
                    {'KES'} {p.price.toFixed(0)}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-gray-500 py-12">
              —
            </div>
          )}
        </div>
      </div>

      <div className="w-full md:w-80 lg:w-96 shrink-0 bg-white rounded-xl shadow border flex flex-col max-h-[45vh] md:max-h-none order-2">
        <div className="p-3 border-b font-semibold flex justify-between items-center">
          <span>Cart ({cart.length})</span>
          {cart.length > 0 && (
            <button onClick={() => clearCart()} className="text-xs text-red-500">Clear</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-2 max-h-[calc(100vh-360px)]">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">—</p>
          ) : (
            cart.map((c) => {
              const live = products.find((p) => p.id === c.product.id);
              const price = live?.price ?? c.product.price;
              return (
                <div key={c.product.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.product.name}</div>
                    <div className="text-xs text-gray-500">
                      {settings.currency} {price} × {c.quantity}
                      {live != null && (
                        <span className="ml-2 text-gray-400">
                          ({Math.max(0, live.stock - c.quantity)} left)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateCartQty(c.product.id, c.quantity - 1)}
                      className="w-11 h-11 rounded-xl bg-gray-200 hover:bg-gray-300 text-xl font-bold touch-manipulation"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-base font-semibold">{c.quantity}</span>
                    <button
                      onClick={() => {
                        const r = updateCartQty(c.product.id, c.quantity + 1);
                        if (!r.ok) flash(r.error || 'Max stock');
                      }}
                      className="w-11 h-11 rounded-xl bg-gray-200 hover:bg-gray-300 text-xl font-bold touch-manipulation"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t space-y-2">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{settings.currency} {cartTotal.toFixed(0)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCash}
              disabled={cart.length === 0 || submitting}
              className="flex items-center justify-center gap-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-300 text-white rounded-xl font-semibold"
            >
              <Banknote size={18} /> {submitting ? '…' : 'Cash'}
            </button>
            <button
              onClick={() => cart.length > 0 && !submitting && setShowCreditKeyboard(true)}
              disabled={cart.length === 0 || submitting}
              className="flex items-center justify-center gap-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-300 text-white rounded-xl font-semibold"
            >
              <CreditCard size={18} /> Credit
            </button>
          </div>
          <button
            onClick={handleHoldClick}
            disabled={cart.length === 0 || submitting}
            className="w-full flex items-center justify-center gap-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-300 text-white rounded-xl font-medium"
          >
            <Pause size={16} />
            {lastHoldCustomer ? `Hold (${lastHoldCustomer})` : 'Hold Sale'}
          </button>
          {lastCartSnapshot && cart.length === 0 && (
            <button
              type="button"
              onClick={repeatLastSale}
              className="w-full flex items-center justify-center gap-1 py-2 text-sm text-primary-700 bg-primary-50 border border-primary-100 rounded-xl font-medium"
            >
              <RotateCcw size={14} /> Repeat last sale
            </button>
          )}

          {heldSales.length > 0 && (
            <div className="pt-2 border-t space-y-2">
              <div className="text-xs text-gray-500">Held ({heldSales.length})</div>
              {heldSales.map((h) => (
                <div key={h.id} className="flex gap-1">
                  <button
                    onClick={() => handleResume(h.id, h.customer_name)}
                    className="flex-1 text-left text-sm font-medium px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 truncate touch-manipulation"
                  >
                    <div className="truncate">{h.customer_name} · {h.items.length} items</div>
                    <div className="text-[11px] text-amber-700 font-normal">{holdTimeLeft(h.expires_at)}</div>
                  </button>
                  <button
                    onClick={() => removeHeldSale(h.id)}
                    className="px-3 rounded-xl bg-red-50 text-red-600 border border-red-200"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreditKeyboard && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {recentCreditors.length > 0 && (
            <div className="bg-white border-t px-3 pt-3 pb-1">
              <div className="text-xs text-gray-500 mb-1">Recent creditors</div>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {recentCreditors.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setCreditorName(name)}
                    className="px-3 py-1.5 rounded-full bg-blue-50 text-blue-800 text-sm border border-blue-100"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <QwertyKeyboard
            value={creditorName}
            onChange={setCreditorName}
            onConfirm={handleCreditConfirm}
            onCancel={() => { setShowCreditKeyboard(false); setCreditorName(''); }}
            title="Creditor"
            placeholder=""
          />
        </div>
      )}

      {showHoldKeyboard && (
        <QwertyKeyboard
          value={holdName}
          onChange={setHoldName}
          onConfirm={handleHoldConfirm}
          onCancel={() => { setShowHoldKeyboard(false); setHoldName(''); }}
          title="Hold"
          placeholder=""
        />
      )}

      {showPrintPreview && lastSale && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 print:bg-white print:p-0">
          <div className="bg-white rounded-xl shadow-2xl max-w-[320px] w-full p-5 print:shadow-none print:rounded-none print:max-w-none receipt-thermal">
            <div className="text-center font-mono text-sm leading-relaxed">
              <div className="text-base font-bold uppercase tracking-wide">{settings.pub_name}</div>
              <div className="mt-1"><span className="font-bold italic">Till: {settings.till_number}</span></div>
              <div className="text-xs mt-1">Receipt: {lastSale.receipt_no}</div>
              <div className="text-xs">{new Date(lastSale.created_at).toLocaleString()}</div>
              <div className="text-xs">Cashier: {lastSale.cashier_name || '—'}</div>
              <div className="border-t border-b border-dashed border-gray-400 my-3 py-2 space-y-1 text-left">
                {lastSale.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="truncate">{it.name}{it.product_id !== '_discount' ? ` x${it.qty}` : ''}</span>
                    <span className="whitespace-nowrap">{(it.price * it.qty).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-bold text-base">
                <span>TOTAL</span>
                <span>{'KES'} {lastSale.total.toFixed(0)}</span>
              </div>
              <div className="text-xs mt-1 capitalize">
                Payment: {lastSale.payment_method}
                {lastSale.creditor_name && ` (${lastSale.creditor_name})`}
              </div>
              <div className="text-xs mt-3 text-gray-600">{settings.receipt_footer}</div>
            </div>
            <div className="flex gap-2 mt-5 print:hidden">
              <button onClick={doPrint} className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary-600 text-white rounded-xl font-semibold">
                <Printer size={18} /> Print
              </button>
              <button onClick={() => setShowPrintPreview(false)} className="flex-1 py-3 bg-gray-200 rounded-xl font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .receipt-thermal, .receipt-thermal * { visibility: visible; }
          .receipt-thermal {
            position: absolute; left: 0; top: 0;
            width: 80mm; max-width: 80mm; font-size: 12px; padding: 4mm;
          }
        }
      `}</style>
    </div>
  );
}
