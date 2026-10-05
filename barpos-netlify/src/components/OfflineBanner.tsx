import { useSyncStore } from "@/stores/syncStore";
import { Cloud, CloudOff } from "lucide-react";
import { isCloudReady } from "@/lib/supabase";

/** Status only — Sync controls live under Backup & Settings */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const pendingOps = useSyncStore((s) => s.pendingOps);
  const cloud = useSyncStore((s) => s.cloud);

  const pending = pendingOps.filter(
    (o) => o.status === "pending" || o.status === "failed"
  ).length;
  const cloudOn = isCloudReady(cloud);

  // Hide when online and nothing pending
  if (isOnline && pending === 0 && !isSyncing) return null;

  return (
    <div
      className={`shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 ${
        !isOnline
          ? "bg-amber-500 text-white"
          : pending > 0
          ? "bg-sky-600 text-white"
          : "bg-slate-700 text-white"
      }`}
    >
      {!isOnline ? <CloudOff size={14} /> : <Cloud size={14} />}
      <span className="truncate">
        {!isOnline
          ? "Offline — changes saved on this device"
          : isSyncing
          ? "Syncing…"
          : `${pending} change(s) waiting (sync in Settings)`}
      </span>
    </div>
  );
}
