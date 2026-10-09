import { useSyncStore } from "@/stores/syncStore";

/**
 * Connection status:
 * - Online + idle: green dot
 * - Syncing: blue dot
 * - Failed: red dot (alongside status)
 * - Offline: amber/orange dot
 */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastSync = useSyncStore((s) => s.cloud?.last_sync_at);
  const err = useSyncStore((s) => s.cloud?.last_sync_error);
  const lastFail = useSyncStore((s) => s.lastFailureDetail);

  const failed = !!(err || lastFail);

  if (!isOnline) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-slate-800 text-white">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"
          title="Offline"
        />
        <span className="truncate text-amber-200">
          Offline — changes saved on this device; will sync when online
        </span>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-slate-800 text-white">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0"
          title="Syncing"
        />
        <span className="truncate text-blue-200">Syncing with cloud…</span>
        {failed && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 ml-1"
            title={err || lastFail || "Sync error"}
          />
        )}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-slate-800 text-white">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"
          title="Online"
        />
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"
          title={err || lastFail || "Sync failed"}
        />
        <span className="truncate text-red-200">
          Online · sync issue: {err || lastFail}
        </span>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 py-1 text-[10px] font-semibold flex items-center gap-2 bg-slate-800/90 text-white">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"
        title="Online"
      />
      <span className="truncate text-emerald-100">
        Online · shared across devices
        {lastSync ? ` · last sync ${new Date(lastSync).toLocaleTimeString()}` : ""}
      </span>
    </div>
  );
}
