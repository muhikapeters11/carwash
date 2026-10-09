import { useSyncStore } from "@/stores/syncStore";
import { CloudOff, Radio } from "lucide-react";

/** Offline warning, or compact LIVE indicator when online */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const lastSync = useSyncStore((s) => s.cloud?.last_sync_at);
  const err = useSyncStore((s) => s.cloud?.last_sync_error);

  if (!isOnline) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-amber-500 text-white">
        <CloudOff size={14} />
        <span className="truncate">Offline — saved on this device; will sync when online</span>
      </div>
    );
  }

  if (err) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-red-600 text-white">
        <Radio size={14} />
        <span className="truncate">{err}</span>
      </div>
    );
  }

  // Subtle live strip (always on when online) so staff know multi-device is active
  return (
    <div className="shrink-0 px-3 py-1 text-[10px] font-semibold flex items-center gap-1.5 bg-emerald-600/90 text-white">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      <span className="truncate">
        LIVE · shared across all devices
        {lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString()}` : ""}
      </span>
    </div>
  );
}
