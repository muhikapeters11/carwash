import { useState } from "react";
import { useSyncStore } from "@/stores/syncStore";
import { Cloud, CloudOff, RefreshCw, Download } from "lucide-react";
import { isCloudReady } from "@/lib/supabase";

export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const pendingOps = useSyncStore((s) => s.pendingOps);
  const cloud = useSyncStore((s) => s.cloud);
  const syncNow = useSyncStore((s) => s.syncNow);
  const lastFailureDetail = useSyncStore((s) => s.lastFailureDetail);
  const clearFailedOps = useSyncStore((s) => s.clearFailedOps);
  const [msg, setMsg] = useState("");

  const pending = pendingOps.filter(
    (o) => o.status === "pending" || o.status === "failed"
  ).length;
  const cloudOn = isCloudReady(cloud);

  // Always show a slim status when cloud is on (multi-device clarity)
  const showAlways = cloudOn || !isOnline || pending > 0 || isSyncing;
  if (!showAlways) return null;

  const runSync = async (forceLabel?: string) => {
    setMsg("");
    const r = await syncNow({ silent: false });
    setMsg(forceLabel ? `${forceLabel}: ${r.message}` : r.message);
    setTimeout(() => setMsg(""), 4000);
  };

  return (
    <div
      className={`shrink-0 px-3 py-2 text-sm font-medium flex flex-wrap items-center justify-between gap-2 ${
        !isOnline
          ? "bg-amber-500 text-white"
          : pending > 0
          ? "bg-sky-600 text-white"
          : isSyncing
          ? "bg-slate-700 text-white"
          : "bg-emerald-800/90 text-white"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {!isOnline ? <CloudOff size={18} /> : <Cloud size={18} />}
        <span className="truncate">
          {!isOnline
            ? "Offline — sales saved here; will sync when online"
            : isSyncing
            ? "Syncing with cloud…"
            : !cloudOn
            ? pending > 0
              ? `${pending} waiting — set Cloud in Settings`
              : "Cloud off"
            : pending > 0
            ? `${pending} change(s) waiting to sync`
            : cloud.last_sync_at
            ? `Cloud OK · last sync ${new Date(cloud.last_sync_at).toLocaleTimeString()}`
            : "Cloud connected · tap Sync to pull products"}
          {msg ? ` · ${msg}` : ""}{!msg && lastFailureDetail ? ` · ${lastFailureDetail.slice(0, 60)}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isOnline && cloudOn && pending > 0 && lastFailureDetail && (
          <button
            type="button"
            onClick={() => clearFailedOps()}
            className="px-2 py-1 rounded-lg bg-white/10 text-xs font-semibold"
            title="Drop failed queue items (local data stays)"
          >
            Clear failed
          </button>
        )}
        {isOnline && cloudOn && (
          <>
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void runSync("Pull")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 font-semibold touch-manipulation text-xs"
              title="Push queue and pull products from cloud"
            >
              <Download size={14} className={isSyncing ? "animate-spin" : ""} />
              Pull products
            </button>
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void runSync()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 font-semibold touch-manipulation text-xs"
            >
              <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
              Sync now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
