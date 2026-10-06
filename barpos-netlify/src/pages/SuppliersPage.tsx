import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useVirtualKeyboard } from "@/components/ui/VirtualKeyboard";

export function SuppliersPage() {
  const suppliers = useAppStore((s) => s.suppliers);
  const addSupplier = useAppStore((s) => s.addSupplier);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const kb = useVirtualKeyboard();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addSupplier({ name: name.trim(), phone, email });
    setName("");
    setPhone("");
    setEmail("");
    kb.close();
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <h1 className="text-xl font-bold mb-4 text-[var(--text)]">Suppliers</h1>
      <form
        onSubmit={submit}
        className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-6 max-w-md space-y-3"
      >
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Name *</label>
          <input
            readOnly
            value={name}
            onClick={(e) => kb.openFor(name, setName, "alpha", e.currentTarget)}
            placeholder="Supplier name"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Phone</label>
          <input
            readOnly
            value={phone}
            onClick={(e) => kb.openFor(phone, setPhone, "numeric", e.currentTarget)}
            placeholder="Optional"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Email</label>
          <input
            readOnly
            value={email}
            onClick={(e) => kb.openFor(email, setEmail, "alpha", e.currentTarget)}
            placeholder="Optional"
            className="mt-1 w-full px-3 py-2.5 rounded-xl cursor-pointer"
          />
        </div>
        <button type="submit" className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold">
          Add supplier
        </button>
      </form>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
        {suppliers.length === 0 ? (
          <p className="p-6 text-[var(--text-muted)] text-sm">No suppliers</p>
        ) : (
          suppliers.map((s) => (
            <div key={s.id} className="px-5 py-3">
              <div className="font-medium text-[var(--text)]">{s.name}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {[s.phone, s.email].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))
        )}
      </div>
      {kb.Keyboard}
    </div>
  );
}
