import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSyncStore } from "@/stores/syncStore";
import { Delete } from "lucide-react";

export function LoginPage() {
  const login = useAppStore((s) => s.login);
  const settings = useAppStore((s) => s.settings);
  const theme = settings?.theme ?? "light";
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Silent cloud pull so other devices get users/products — no UI text
  useEffect(() => {
    const s = useSyncStore.getState();
    if (s.isOnline && s.cloud?.enabled) {
      void s.syncNow({ silent: true });
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    inputRef.current?.focus();
  }, [theme]);

  const tryLogin = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length < 4) return;
    const ok = login(cleaned);
    if (!ok) {
      setError("Invalid PIN");
      setPin("");
      inputRef.current?.focus();
    } else {
      setError("");
    }
  };

  const press = (k: string) => {
    setError("");
    if (k === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (k === "ok") {
      tryLogin(pin);
      return;
    }
    const next = (pin + k).replace(/\D/g, "").slice(0, 8);
    setPin(next);
    if (next.length >= 4) {
      setTimeout(() => tryLogin(next), 80);
    }
  };

  const onPhysicalKey = (e: React.KeyboardEvent) => {
    setError("");
    if (e.key === "Enter") {
      e.preventDefault();
      tryLogin(pin);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const next = (pin + e.key).slice(0, 8);
      setPin(next);
      if (next.length >= 4) setTimeout(() => tryLogin(next), 80);
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
  const businessName = settings?.business_name || "Bar POS";

  return (
    <div
      className="h-screen w-screen flex items-center justify-center bg-slate-900 select-none"
      onKeyDown={onPhysicalKey}
      tabIndex={0}
    >
      <div className="w-full max-w-md px-5">
        <div className="text-center mb-8">
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
              alt=""
              className="mx-auto h-20 w-20 object-contain rounded-2xl mb-4"
            />
          ) : null}
          <h1 className="text-2xl font-bold text-white tracking-tight">{businessName}</h1>
        </div>

        <div className="relative mb-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 8);
              setPin(next);
              setError("");
              if (next.length >= 4) setTimeout(() => tryLogin(next), 80);
            }}
            onKeyDown={onPhysicalKey}
            className="w-full text-center text-5xl font-bold tracking-[0.35em] py-4 rounded-2xl bg-slate-800 text-white border-2 border-slate-600 outline-none focus:border-amber-400"
            placeholder="····"
            aria-label="PIN"
          />
        </div>

        {error && (
          <p className="text-center text-red-400 text-sm mb-3 font-medium">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className={`h-24 rounded-2xl text-4xl font-bold active:scale-95 transition touch-manipulation ${
                k === "ok"
                  ? "bg-amber-500 text-white"
                  : k === "del"
                  ? "bg-slate-700 text-white"
                  : "bg-slate-800 text-white active:bg-slate-600"
              }`}
            >
              {k === "del" ? <Delete className="mx-auto" size={32} /> : k === "ok" ? "OK" : k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
