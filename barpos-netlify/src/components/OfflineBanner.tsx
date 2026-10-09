import { useSyncStore } from "@/stores/syncStore";

/** Status dots only: green online, blue syncing, red failed, amber offline */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const err = useSyncStore((s) => s.cloud?.last_sync_error);
  const lastFail = useSyncStore((s) => s.lastFailureDetail);
  const failed = !!(err || lastFail);

  if (!isOnline) {
    return (
      <div className="shrink-0 flex items-center justify-end px-2 py-1 gap-1.5 bg-transparent">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" title="Offline" />
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="shrink-0 flex items-center justify-end px-2 py-1 gap-1.5 bg-transparent">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" title="Syncing" />
        {failed && (
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="Sync error" />
        )}
      </div>
    );
  }

  return (
    <div className="shrink-0 flex items-center justify-end px-2 py-1 gap-1.5 bg-transparent">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" title="Online" />
      {failed && (
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title={err || lastFail || "Sync error"} />
      )}
    </div>
  );
}
