import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSyncStore } from "@/stores/syncStore";
import { isCloudReady } from "@/lib/supabase";
import { compressImageDataUrl } from "@/lib/compressImage";

export const APP_VERSION = "0.4.0";

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetSystem = useAppStore((s) => s.resetSystem);
  const session = useAppStore((s) => s.session)!;
  const products = useAppStore((s) => s.products);
  const sales = useAppStore((s) => s.sales);
  const credits = useAppStore((s) => s.credits);
  const expenses = useAppStore((s) => s.expenses);
  const users = useAppStore((s) => s.users);
  const suppliers = useAppStore((s) => s.suppliers);
  const [form, setForm] = useState({ ...settings });
  const [msg, setMsg] = useState("");
  const [printers, setPrinters] = useState<string[]>([]);
  useEffect(() => {
    // Chrome may expose printer list; otherwise user types name
    const nav = navigator as Navigator & {
      getPrinters?: () => Promise<{ name: string }[]>;
    };
    if (typeof nav.getPrinters === "function") {
      nav.getPrinters().then((list) => {
        setPrinters(list.map((p) => p.name).filter(Boolean));
      }).catch(() => {});
    }
  }, []);
  const [resetPin, setResetPin] = useState("");
  const logoRef = useRef<HTMLInputElement>(null);
  const cloud = useSyncStore((s) => s.cloud);
  const setCloud = useSyncStore((s) => s.setCloud);
  const syncNow = useSyncStore((s) => s.syncNow);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const pendingOps = useSyncStore((s) => s.pendingOps);
  const deviceId = useSyncStore((s) => s.deviceId);
  const isOnline = useSyncStore((s) => s.isOnline);
  const lastFailureDetail = useSyncStore((s) => s.lastFailureDetail);
  const clearFailedOps = useSyncStore((s) => s.clearFailedOps);
  const [cloudForm, setCloudForm] = useState({
    enabled: cloud.enabled,
    supabase_url: cloud.supabase_url,
    supabase_anon_key: cloud.supabase_anon_key,
  });
  const [syncMsg, setSyncMsg] = useState("");

  if (session.role !== "admin") {
    return (
      <div className="p-6 text-[var(--text-muted)]">Only admin can access settings.</div>
    );
  }

  const save = () => {
    updateSettings(form);
    setMsg("Settings saved");
  };

  const doReset = async () => {
    const admin = useAppStore.getState().users.find((u) => u.role === "admin" && u.is_active);
    const pinOk = admin && resetPin === admin.pin;
    if (!pinOk) {
      setMsg("Enter the admin PIN to confirm reset");
      return;
    }
    if (
      !window.confirm(
        "This will ERASE ALL local data AND cloud data (products, sales, credits, everything). Continue?"
      )
    ) {
      return;
    }
    setMsg("Resetting local + cloud…");
    const result = await resetSystem();
    setMsg(result.message);
    setResetPin("");
  };

  const compressLogo = (dataUrl: string) => compressImageDataUrl(dataUrl, 256, 0.72);

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setMsg("Logo too large (max 8MB). Choose a smaller image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      const logo_url = await compressLogo(raw);
      const next = { ...form, logo_url };
      setForm(next);
      updateSettings(next); // save local + queue cloud settings_upsert
      setMsg("Logo saved — syncing to cloud…");
      const { useSyncStore } = await import("@/stores/syncStore");
      const s = useSyncStore.getState();
      if (s.isOnline) {
        const r = await s.syncNow({ silent: false });
        setMsg(r.ok ? "Logo synced to all devices" : `Logo saved locally. Sync: ${r.message}`);
      }
    };
    reader.readAsDataURL(file);
  };

  const exportJson = () => {
    const payload = {
      version: APP_VERSION,
      exported_at: new Date().toISOString(),
      settings,
      products,
      sales,
      credits,
      expenses,
      users: users.map((u) => ({ ...u, pin: "****" })),
      suppliers,
    };
    downloadBlob(
      `barpos-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setMsg("Full JSON backup downloaded");
  };

  const exportProductsCsv = () => {
    const header = "sku,name,category,price,cost,stock_quantity,min_stock,units_per_pack,pack_label,is_active\n";
    const rows = products
      .map(
        (p) =>
          `${p.sku},${JSON.stringify(p.name)},${p.category},${p.price / 100},${p.cost / 100},${p.stock_quantity},${p.min_stock ?? 0},${p.units_per_pack || 1},${p.pack_label || ""},${p.is_active !== false}`
      )
      .join("\n");
    downloadBlob(`products-${new Date().toISOString().slice(0, 10)}.csv`, header + rows, "text/csv");
    setMsg("Products CSV downloaded");
  };

  const exportSalesCsv = () => {
    const header = "sale_number,date,cashier,payment_method,total,status,is_credit_payment\n";
    const rows = sales
      .map(
        (s) =>
          `${s.sale_number},${s.created_at},${JSON.stringify(s.cashier_name)},${s.payment_method},${s.total / 100},${s.status},${!!s.is_credit_payment}`
      )
      .join("\n");
    downloadBlob(`sales-${new Date().toISOString().slice(0, 10)}.csv`, header + rows, "text/csv");
    setMsg("Sales CSV downloaded");
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <div className="flex items-baseline justify-between gap-3 mb-4 max-w-lg">
        <h1 className="text-xl font-bold text-[var(--text)]">Backup & Settings</h1>
        <span className="text-xs text-[var(--text-muted)] font-mono">v{APP_VERSION}</span>
      </div>
      {msg && (
        <div className="mb-4 text-sm bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-3 py-2 rounded-lg max-w-lg">
          {msg}
        </div>
      )}

      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-4 space-y-3 max-w-lg">
        <h2 className="font-bold text-[var(--text)]">Business & branding</h2>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => logoRef.current?.click()}
            className="w-20 h-20 rounded-xl border-2 border-dashed border-[var(--border)] overflow-hidden flex items-center justify-center bg-[var(--bg-muted)]"
          >
            {form.logo_url ? (
              <img src={form.logo_url} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-[var(--text-muted)] text-center px-1">Add logo</span>
            )}
          </button>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={onLogo} />
          <div className="text-sm text-[var(--text-muted)]">
            Logo on login & sidebar (not on thermal receipt).
            {form.logo_url && (
              <button
                type="button"
                className="block mt-1 text-red-500 text-xs"
                onClick={() => setForm({ ...form, logo_url: undefined })}
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Bar name *</label>
          <input
            value={form.business_name}
            onChange={(e) => setForm({ ...form, business_name: e.target.value })}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)] outline-none focus:border-amber-400"
          />
        </div>
        <input
          placeholder="Phone"
          value={form.business_phone}
          onChange={(e) => setForm({ ...form, business_phone: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
        />
        <input
          placeholder="Location (shown on receipt)"
          value={form.business_location || ""}
          onChange={(e) => setForm({ ...form, business_location: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
        />
        <input
          placeholder="Address"
          value={form.business_address}
          onChange={(e) => setForm({ ...form, business_address: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
        />
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Till number (on every receipt)</label>
          <input
            placeholder="Enter till number"
            value={form.till_number || ""}
            onChange={(e) => setForm({ ...form, till_number: e.target.value })}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
          />
        </div>
        <input
          placeholder="Receipt footer"
          value={form.receipt_footer}
          onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
        />
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Theme (this device only)</label>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, theme: "light" })}
              className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${
                form.theme === "light"
                  ? "bg-amber-500 text-white border-amber-500"
                  : "border-[var(--border)] text-[var(--text)]"
              }`}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, theme: "dark" })}
              className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${
                form.theme === "dark"
                  ? "bg-amber-500 text-white border-amber-500"
                  : "border-[var(--border)] text-[var(--text)]"
              }`}
            >
              Dark
            </button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Thermal width</label>
          <select
            value={form.thermal_width_mm}
            onChange={(e) => setForm({ ...form, thermal_width_mm: Number(e.target.value) })}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
          >
            <option value={58}>58mm</option>
            <option value={80}>80mm</option>
          </select>
        </div>
        <button onClick={save} className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold">
          Save Settings
        </button>
      </section>

      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-4 space-y-3 max-w-lg">
        <h2 className="font-bold text-[var(--text)]">Backup & export</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Download copies to this computer (USB/folder). One-tap backups for products and sales.
        </p>
        <button
          type="button"
          onClick={exportJson}
          className="w-full py-3 rounded-xl bg-slate-800 text-white font-bold touch-manipulation"
        >
          Export full backup (JSON)
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={exportProductsCsv}
            className="py-3 rounded-xl border border-[var(--border)] font-semibold text-[var(--text)] touch-manipulation"
          >
            Products CSV
          </button>
          <button
            type="button"
            onClick={exportSalesCsv}
            className="py-3 rounded-xl border border-[var(--border)] font-semibold text-[var(--text)] touch-manipulation"
          >
            Sales CSV
          </button>
        </div>
      </section>


      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-4 space-y-3 max-w-lg">
        
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
          <h2 className="font-bold text-[var(--text)]">Receipt printer (this device)</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Web browsers usually show the system print dialog once. Choose your thermal printer there and enable “Remember”.
            Preferred name is saved on this device only.
          </p>
          <label className="text-sm text-[var(--text)]">Preferred printer</label>
          {printers.length > 0 ? (
            <select
              value={form.preferred_printer || ""}
              onChange={(e) => setForm({ ...form, preferred_printer: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
            >
              <option value="">System default</option>
              {printers.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          ) : (
            <input
              placeholder="e.g. EPSON TM-T20 (optional)"
              value={form.preferred_printer || ""}
              onChange={(e) => setForm({ ...form, preferred_printer: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
            />
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              checked={form.auto_print_receipt !== false}
              onChange={(e) => setForm({ ...form, auto_print_receipt: e.target.checked })}
            />
            Auto-print receipt after payment
          </label>
        </div>

        <h2 className="font-bold text-[var(--text)]">Cloud sync</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Connect Supabase so tills share sales and stock. Works offline; syncs when online.
        </p>
        <div className="text-xs text-[var(--text-muted)] space-y-1 font-mono break-all">
          <div>Device: {deviceId}</div>
          <div>Network: {isOnline ? "Online" : "Offline"}</div>
          <div>
            Queue: {pendingOps.filter((o) => o.status === "pending" || o.status === "failed").length} pending
          </div>
          {cloud.last_sync_at && (
            <div>Last sync: {new Date(cloud.last_sync_at).toLocaleString()}</div>
          )}
          {cloud.last_sync_error && (
            <div className="text-red-500">{cloud.last_sync_error}</div>
          )}
          {lastFailureDetail && (
            <div className="text-red-500 text-xs break-all">Detail: {lastFailureDetail}</div>
          )}
          {pendingOps.some((o) => o.status === "failed") && (
            <button
              type="button"
              onClick={() => clearFailedOps()}
              className="text-xs underline text-[var(--text-muted)]"
            >
              Clear failed sync items (keeps local sales)
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={cloudForm.enabled}
            onChange={(e) => setCloudForm({ ...cloudForm, enabled: e.target.checked })}
            className="w-5 h-5"
          />
          Enable cloud sync
        </label>
        <div>
          <label className="text-sm text-[var(--text)]">Supabase project URL</label>
          <input
            value={cloudForm.supabase_url}
            onChange={(e) => setCloudForm({ ...cloudForm, supabase_url: e.target.value })}
            placeholder="https://xxxx.supabase.co"
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
          />
        </div>
        <div>
          <label className="text-sm text-[var(--text)]">Supabase anon (public) key</label>
          <input
            value={cloudForm.supabase_anon_key}
            onChange={(e) => setCloudForm({ ...cloudForm, supabase_anon_key: e.target.value })}
            placeholder="eyJhbGciOi..."
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setCloud({
              enabled: cloudForm.enabled,
              supabase_url: cloudForm.supabase_url.trim(),
              supabase_anon_key: cloudForm.supabase_anon_key.trim(),
            });
            setSyncMsg("Cloud settings saved on this device");
          }}
          className="w-full py-3 rounded-xl border border-[var(--border)] font-bold text-[var(--text)]"
        >
          Save cloud settings
        </button>
        <button
          type="button"
          disabled={isSyncing || !isOnline}
          onClick={async () => {
            setCloud({
              enabled: cloudForm.enabled,
              supabase_url: cloudForm.supabase_url.trim(),
              supabase_anon_key: cloudForm.supabase_anon_key.trim(),
            });
            const r = await syncNow();
            setSyncMsg(r.message);
          }}
          className="w-full py-3 rounded-xl bg-sky-600 text-white font-bold disabled:opacity-40"
        >
          {isSyncing ? "Syncing…" : "Sync now / pull products"}
        </button>
        {syncMsg && (
          <p className="text-sm text-[var(--text-muted)]">{syncMsg}</p>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Setup steps: create a free Supabase project → SQL editor → run{" "}
          <code className="text-[var(--text)]">supabase/schema.sql</code> → paste URL + anon key here
          on <strong>every</strong> device. Use Pull products on the top bar on other tills. Enable Realtime for <code className="text-[var(--text)]">products</code> (Database → Replication).
        </p>
      </section>

      <section className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-4 max-w-lg space-y-2">
        <h2 className="font-bold text-[var(--text)]">About</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Bar POS <span className="font-mono text-[var(--text)]">v{APP_VERSION}</span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Offline-first. Enable Cloud sync above for multi-device. ESC/POS printers and server-side role enforcement are next production steps.
        </p>
      </section>

      <section className="bg-[var(--bg-card)] rounded-2xl border border-red-200 dark:border-red-800 p-5 max-w-lg space-y-3">
        <h2 className="font-bold text-red-700 dark:text-red-400">Reset to clean slate</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Erases ALL data on this device and cloud. Enter <strong>admin PIN</strong> to confirm. After: login PIN 1234.
        </p>
        <input
          placeholder="Admin PIN"
          type="password"
          inputMode="numeric"
          value={resetPin}
          onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]"
        />
        <button onClick={doReset} className="w-full py-3 rounded-xl bg-red-600 text-white font-bold">
          Wipe entire system
        </button>
      </section>
    </div>
  );
}
