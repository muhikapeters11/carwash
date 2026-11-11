import React, { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import QwertyKeyboard from '../components/QwertyKeyboard';
import NumericPad from '../components/NumericPad';
import { buildBackup, downloadBackupJson, parseBackupFile, shouldRemindBackup, daysSinceLastBackup } from '../lib/backup';
import { isSupabaseConfigured } from '../lib/supabase';
import { clearOfflineQueue, isOnline } from '../lib/offline';
import { clearOfflineAuth } from '../lib/offlineAuth';
import { wipeCloudData, clearProductsAndReports, resetLocalProductPushFlag } from '../lib/sync';
import { clearAllTombstones } from '../lib/tombstones';
import { allowDemoMode, appVersion } from '../lib/config';
import { loginWithPin } from '../lib/auth';

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const currentUser = useStore((s) => s.currentUser);

  const [local, setLocal] = useState({ ...settings });
  const [activeField, setActiveField] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [showClearData, setShowClearData] = useState(false);
  const [clearPin, setClearPin] = useState('');
  const imgRef = useRef<HTMLInputElement>(null);

  if (currentUser?.role !== 'admin') {
    return <div className="p-8 text-center">—</div>;
  }

  const save = () => {
    updateSettings(local);
    alert('Saved');
  };

  const clearProductsAndSalesHistory = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    if (!/^\d{6}$/.test(clearPin)) { alert('Enter the six-digit admin PIN.'); return; }
    if (isSupabaseConfigured && !isOnline()) { alert('Connect to the internet before clearing cloud data.'); return; }
    if (!confirm('CLEAR PRODUCTS & REPORT HISTORY?\n\nThis permanently removes all products, sales and sale items, credits/payments, expenses, stock receiving history, held sales and activity logs from every connected device. Staff accounts and pub settings will remain. This cannot be undone.')) return;
    if (isSupabaseConfigured) {
      const result = await clearProductsAndReports(clearPin, currentUser.id);
      if (!result.ok) {
        alert(
          `Cloud cleanup failed: ${result.error || 'Unknown error'}\n\nNo local data was cleared.\n\nRun PUB_POS_ALL_IN_ONE.sql (or CLEAR_PRODUCTS_AND_REPORTS.sql) in Supabase, then retry.`
        );
        return;
      }
      // Mark this reset so the next pull does not treat the empty cloud as
      // "first install" and re-upload a stale local catalogue.
      if (result.factoryResetAt) {
        try {
          localStorage.setItem('pub-pos-cloud-reset-at', String(result.factoryResetAt));
        } catch {
          /* ignore */
        }
      }
    } else {
      const check = await loginWithPin(clearPin, useStore.getState().staffUsers);
      if (!check.ok || check.user.id !== currentUser.id || check.user.role !== 'admin') {
        alert('Wrong admin PIN');
        return;
      }
    }
    clearOfflineQueue();
    clearAllTombstones();
    resetLocalProductPushFlag();
    useStore.setState({
      products: [],
      sales: [],
      credits: [],
      expenses: [],
      heldSales: [],
      cart: [],
      stockReceives: [],
      activityLogs: [],
      notifications: [],
    });
    setShowClearData(false);
    setClearPin('');
    alert('Products and report history cleared. Staff accounts and settings were kept.');
  };

  const factoryReset = async () => {
    if (currentUser?.role !== 'admin') {
      alert('Only an admin can factory-reset');
      return;
    }
    if (!/^\d{6}$/.test(resetPin)) {
      alert('Enter the six-digit admin PIN.');
      return;
    }
    // A cloud reset must reach Supabase. Never report a clean start while offline.
    if (isSupabaseConfigured && !isOnline()) {
      alert('Connect this device to the internet before factory resetting. Cloud data has not been changed.');
      return;
    }
    // Local/demo mode has no server-side PIN check, so validate against its local users.
    if (!isSupabaseConfigured) {
      const check = await loginWithPin(resetPin, useStore.getState().staffUsers);
      if (!check.ok || check.user.id !== currentUser.id || check.user.role !== 'admin') {
        alert('Wrong admin PIN');
        return;
      }
    }

    const msg = isSupabaseConfigured
      ? 'FACTORY RESET\n\nThis permanently deletes all POS data on this device and in the cloud: products, sales, credits, expenses, stock records, logs, notifications, held sales and settings. All cashier accounts and other admin accounts will be deleted.\n\nOnly the admin account used to confirm this reset will remain so you can sign in and configure the fresh system.\n\nThis cannot be undone. Continue?'
      : 'FACTORY RESET\n\nThis will permanently delete ALL POS data on this device, including products, sales, users, settings and offline data.\n\nThis cannot be undone. Continue?';

    if (!confirm(msg)) return;
    if (isSupabaseConfigured && !confirm('Final confirmation: wipe CLOUD data as well?')) return;

    // 1. Wipe cloud first (so a later sync cannot restore old data)
    let cloudCountProducts = 0;
    let cloudCountSales = 0;
    if (isSupabaseConfigured) {
      const cloud = await wipeCloudData(resetPin, currentUser.id);
      if (!cloud.ok) {
        alert(
          'Cloud wipe failed: ' +
            (cloud.error || 'unknown') +
            '\n\nNo local data was cleared, and the cloud transaction was rolled back.\n\nRun the updated supabase/factory_reset_cloud.sql in Supabase SQL Editor, wait for it to finish successfully, then retry.'
        );
        return;
      }
      cloudCountProducts = cloud.productsDeleted || 0;
      cloudCountSales = cloud.salesDeleted || 0;
    }

    // 2. Clear the in-memory store. The authenticated admin is retained only in
    // the cloud; the device session and every cached credential are removed.
    useStore.setState({
      currentUser: null,
      sales: [], credits: [], expenses: [], heldSales: [], notifications: [],
      cart: [], stockReceives: [], activityLogs: [], products: [], staffUsers: [],
      activeTab: 'dashboard',
      settings: {
        pub_name: 'Carwash Bar & Restaurant',
        till_number: 'TILL-001', receipt_footer: '', currency: 'KES',
        logo_url: '/logo.png', login_bg_url: undefined,
      },
    });

    // 3. Remove all browser-local POS data and credentials. This app uses a
    // dedicated origin, so clear both storage areas rather than missing keys.
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    clearOfflineQueue();
    clearOfflineAuth();

    setShowReset(false);
    setResetPin('');
    alert(
      isSupabaseConfigured
        ? `Factory reset complete. Deleted ${cloudCountProducts} products and ${cloudCountSales} sales from the cloud. The confirming admin account remains. Reloading…`
        : 'Factory reset complete. Reloading…'
    );
    window.location.reload();
  };


  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-white rounded-xl shadow p-5 space-y-4">
        <div>
          <label className="text-sm text-gray-600">Pub Name</label>
          <button
            onClick={() => setActiveField('pub_name')}
            className="w-full mt-1 text-left border rounded-lg px-3 py-2.5 bg-gray-50"
          >
            {local.pub_name}
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600">Till Number</label>
          <button
            onClick={() => setActiveField('till_number')}
            className="w-full mt-1 text-left border rounded-lg px-3 py-2.5 bg-gray-50"
          >
            {local.till_number}
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600">Receipt Footer</label>
          <button
            onClick={() => setActiveField('receipt_footer')}
            className="w-full mt-1 text-left border rounded-lg px-3 py-2.5 bg-gray-50"
          >
            {local.receipt_footer}
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600">Currency</label>
          <div className="w-full mt-1 border rounded-lg px-3 py-2 bg-gray-50 text-gray-700">
            KES (Kenya Shillings)
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-600">Business day starts at (hour 0–23)</label>
          <input
            type="number"
            min={0}
            max={23}
            value={local.business_day_hour ?? 9}
            onChange={(e) =>
              setLocal({
                ...local,
                business_day_hour: Math.min(23, Math.max(0, parseInt(e.target.value || '9', 10) || 9)),
              })
            }
            className="w-full mt-1 border rounded-lg px-3 py-2.5 bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1">
            Sales before this local hour count toward the previous business day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="receipt_show_cost"
            checked={!!local.receipt_show_cost}
            onChange={(e) => setLocal({ ...local, receipt_show_cost: e.target.checked })}
            className="w-4 h-4"
          />
          <label htmlFor="receipt_show_cost" className="text-sm text-gray-700">
            Show cost on receipts
          </label>
        </div>
        <div className="text-sm text-gray-500 border-t pt-3">
          Last successful sync:{' '}
          <span className="font-medium text-gray-800">
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'}
          </span>
        </div>
        <div>
          <label className="text-sm text-gray-600">Logo</label>
          <div className="mt-1 flex items-center gap-3">
            {local.logo_url && (
              <img src={local.logo_url} className="w-16 h-16 object-contain rounded" />
            )}
            <button
              onClick={() => imgRef.current?.click()}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              Upload Logo
            </button>
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setLocal({ ...local, logo_url: r.result as string });
                r.readAsDataURL(f);
              }}
            />
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-600">Login Background</label>
          <div className="mt-1 flex items-center gap-3">
            {local.login_bg_url && (
              <img src={local.login_bg_url} className="w-24 h-14 object-cover rounded border" />
            )}
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (ev: any) => {
                  const f = ev.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setLocal({ ...local, login_bg_url: r.result as string });
                  r.readAsDataURL(f);
                };
                input.click();
              }}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              Upload Background
            </button>
            {local.login_bg_url && (
              <button
                onClick={() => setLocal({ ...local, login_bg_url: undefined })}
                className="px-3 py-2 border rounded-lg text-sm text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <button
          onClick={save}
          className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold"
        >
          Save
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <h2 className="font-bold">Backup</h2>
        <p className="text-xs text-gray-500">
          {shouldRemindBackup() ? 'Backup recommended' : `Last backup ${daysSinceLastBackup()?.toFixed(1) || '—'} days ago`}
          {' · '}v{appVersion}
          {isSupabaseConfigured ? ' · Server connected' : ' · Local only'}
          {allowDemoMode ? ' · Demo on' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const s = useStore.getState();
              downloadBackupJson(buildBackup({
                products: s.products,
                sales: s.sales,
                credits: s.credits,
                expenses: s.expenses,
                heldSales: s.heldSales,
                stockReceives: s.stockReceives,
                activityLogs: s.activityLogs,
                notifications: s.notifications,
                settings: s.settings,
                staffUsers: s.staffUsers,
              }));
              alert('Backup downloaded');
            }}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold"
          >
            Export backup
          </button>
          <button
            type="button"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'application/json,.json';
              input.onchange = async () => {
                const f = input.files?.[0];
                if (!f) return;
                const text = await f.text();
                const data = parseBackupFile(text);
                if (!data) { alert('Invalid backup'); return; }
                if (!confirm('Replace local data with backup?')) return;
                useStore.setState({
                  products: data.products || [],
                  sales: data.sales || [],
                  credits: data.credits || [],
                  expenses: data.expenses || [],
                  heldSales: data.heldSales || [],
                  stockReceives: data.stockReceives || [],
                  activityLogs: data.activityLogs || [],
                  notifications: data.notifications || [],
                  settings: data.settings || useStore.getState().settings,
                  staffUsers: data.staffUsers || [],
                  cart: [],
                });
                alert('Restored');
              };
              input.click();
            }}
            className="px-4 py-2 border rounded-lg text-sm font-semibold"
          >
            Restore backup
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h2 className="font-bold text-amber-800 mb-2">Clear Products & Reports</h2>
        <p className="text-sm text-amber-900/80 mb-3">Delete the product catalogue and historical sales/report records across all tills, while keeping staff accounts and pub settings.</p>
        <button onClick={() => setShowClearData(true)} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm">Clear Products & Reports</button>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-5">
        <h2 className="font-bold text-red-700 mb-2">Factory Reset</h2>
        <p className="text-sm text-red-700/80 mb-3">
          Permanently deletes products, sales, credits, expenses, stock and logs
          {isSupabaseConfigured ? ' on this device and in the cloud' : ' on this device'}.
          The admin account used to confirm the reset is retained so you can sign in again. All products, sales and dependent business records are deleted.
        </p>
        <button
          onClick={() => setShowReset(true)}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm"
        >
          Factory Reset
        </button>
      </div>

      {activeField && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md">
            <QwertyKeyboard
              value={(local as any)[activeField] || ''}
              onChange={(v) => setLocal({ ...local, [activeField]: v })}
              onConfirm={() => setActiveField(null)}
              title={`Edit ${activeField.replace('_', ' ')}`}
            />
          </div>
        </div>
      )}

      {showClearData && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="font-bold text-amber-700 mb-2">Confirm Clear Products & Reports</h2>
            <p className="text-sm text-gray-600 mb-3">Enter your admin PIN. Staff users and settings will remain.</p>
            <div className="bg-gray-900 rounded-xl overflow-hidden">
              <NumericPad value={clearPin} onChange={setClearPin} onConfirm={clearProductsAndSalesHistory} maxLength={6} allowDecimal={false} large />
            </div>
            <button onClick={() => { setShowClearData(false); setClearPin(''); }} className="w-full mt-3 py-2 bg-gray-200 rounded-xl">Cancel</button>
          </div>
        </div>
      )}

      {showReset && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="font-bold text-red-600 mb-2">Confirm Reset</h2>
            
            <div className="bg-gray-900 rounded-xl overflow-hidden">
              <NumericPad
                value={resetPin}
                onChange={setResetPin}
                onConfirm={factoryReset}
                maxLength={6}
                allowDecimal={false}
                large
              />
            </div>
            <button
              onClick={() => {
                setShowReset(false);
                setResetPin('');
              }}
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
