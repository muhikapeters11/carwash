import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSyncStore } from "@/stores/syncStore";
import { Delete } from "lucide-react";

export function LoginPage() {
  const login = useAppStore((s) => s.login);
  const resetAdminPin = useAppStore((s) => s.resetAdminPin);
  const settings = useAppStore((s) => s.settings);
  const theme = settings?.theme ?? "light";
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [msg, setMsg] = useState("");
  const [cloudReady, setCloudReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // When online: pull latest users/PINs from cloud BEFORE allowing login
  useEffect(() => {
    let cancelled = false;

    const pullCloudFirst = async () => {
      const s = useSyncStore.getState();
      const online = typeof navigator !== "undefined" && navigator.onLine;
      if (!online || !s.cloud?.supabase_url || !s.cloud?.supabase_anon_key) {
        if (!cancelled) setCloudReady(true);
        return;
      }
      if (!s.cloud.enabled) useSyncStore.getState().setCloud({ enabled: true });
      try {
        // Prefer a dedicated users pull so login always sees latest PINs/deletes
        const { pullAllRemote, applyRemoteSnapshot } = await import("@/lib/sync/pullAll");
        const { isCloudReady } = await import("@/lib/supabase");
        const cloud = useSyncStore.getState().cloud;
        if (isCloudReady(cloud)) {
          const snap = await Promise.race([
            pullAllRemote(cloud),
            new Promise<null>((r) => setTimeout(() => r(null), 12000)),
          ]);
          if (snap && !cancelled) {
            await applyRemoteSnapshot(
              snap,
              () => useAppStore.getState(),
              (patch) => useAppStore.setState(patch)
            );
          }
        }
        // Also flush any pending local ops (user deletes/adds from this device)
        await Promise.race([
          useSyncStore.getState().syncNow({ silent: true }),
          new Promise((r) => setTimeout(r, 8000)),
        ]);
      } catch {
        /* use local cache */
      }
      if (!cancelled) setCloudReady(true);
    };

    void pullCloudFirst();

    // Re-pull when tab becomes visible or device comes online
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void pullCloudFirst();
      }
    };
    const onOnline = () => {
      void pullCloudFirst();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    if (cloudReady) inputRef.current?.focus();
  }, [theme, cloudReady]);

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
    if (mode !== "login") return;
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

  const submitRecover = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    setError("");
    if (newPin !== confirmPin) {
      setError("New PINs do not match");
      return;
    }
    const result = resetAdminPin(recoveryCode, newPin);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMsg(result.message);
    setMode("login");
    setRecoveryCode("");
    setNewPin("");
    setConfirmPin("");
    setPin("");
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
  const businessName = settings?.business_name || "Bar POS";

  if (!cloudReady) {
    const online = typeof navigator !== "undefined" && navigator.onLine;
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-6 bg-[var(--bg)]">
        <div className="text-lg font-bold text-[var(--text)] mb-2">{businessName}</div>
        <div className="text-sm text-[var(--text-muted)]">
          {online ? "Syncing latest users from cloud…" : "Loading local data…"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-[var(--bg)]">
      {settings?.logo_url ? (
        <img
          src={settings.logo_url}
          alt=""
          className="w-20 h-20 rounded-2xl object-cover mb-4 border border-[var(--border)]"
        />
      ) : null}
      <h1 className="text-2xl font-extrabold text-[var(--text)] mb-1">{businessName}</h1>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        {mode === "login" ? "Enter PIN" : "Admin PIN recovery"}
      </p>

      {mode === "login" ? (
        <>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={() => {}}
            onKeyDown={onPhysicalKey}
            className="w-64 max-w-[90vw] text-center text-4xl tracking-[0.5em] py-4 rounded-2xl border-2 border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] mb-4"
            readOnly
            autoComplete="off"
          />
          {error ? <p className="text-red-500 text-base mb-2">{error}</p> : null}
          {msg ? <p className="text-emerald-600 text-base mb-2">{msg}</p> : null}

          <div className="grid grid-cols-3 gap-4 w-full max-w-md mt-2 px-1">
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                className="h-20 sm:h-24 min-h-[4.5rem] rounded-2xl bg-[var(--bg-card)] border-2 border-[var(--border)] text-3xl sm:text-4xl font-bold text-[var(--text)] active:bg-amber-500 active:text-white touch-manipulation shadow-sm"
              >
                {k === "del" ? <Delete className="mx-auto" size={32} /> : k === "ok" ? "OK" : k}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setMode("recover");
              setError("");
              setMsg("");
            }}
            className="mt-6 text-sm text-amber-600 font-semibold"
          >
            Forgot admin PIN?
          </button>
        </>
      ) : (
        <form onSubmit={submitRecover} className="w-full max-w-sm space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Enter the recovery code set in Settings (admin only), then choose a new PIN.
          </p>
          <div>
            <label className="text-sm font-medium text-[var(--text)]">Recovery code</label>
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text)]">New admin PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
              required
              minLength={4}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--text)]">Confirm new PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="mt-1 w-full px-3 py-3 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)]"
              required
              minLength={4}
            />
          </div>
          {error ? <p className="text-red-500 text-sm">{error}</p> : null}
          <button type="submit" className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold">
            Reset admin PIN
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className="w-full py-3 rounded-xl border border-[var(--border)] font-semibold text-[var(--text)]"
          >
            Back to login
          </button>
        </form>
      )}
    </div>
  );
}
