import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CloudConfig, PendingOp, PendingOpType } from "@/types/sync";
import { getDeviceId } from "@/lib/device";
import { getCloudConfigFromEnv, isCloudReady, probeCloud } from "@/lib/supabase";
import { flushQueue } from "@/lib/sync";
import { pullAllRemote, applyRemoteSnapshot } from "@/lib/sync/pullAll";
import { uid } from "@/lib/utils";

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  deviceId: string;
  cloud: CloudConfig;
  pendingOps: PendingOp[];
  lastFailureDetail?: string;
  setOnline: (v: boolean) => void;
  setCloud: (patch: Partial<CloudConfig>) => void;
  enqueue: (type: PendingOpType, payload: unknown) => void;
  removeOps: (ids: string[]) => void;
  updateFailedOps: (ops: PendingOp[]) => void;
  clearFailedOps: () => void;
  syncNow: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; message: string }>;
  pendingCount: () => number;
}

const env = getCloudConfigFromEnv();

const PROJECT_DEFAULTS = {
  supabase_url: "https://neuducaticwvhqwfsept.supabase.co",
  supabase_anon_key:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ldWR1Y2F0aWN3dmhxd2ZzZXB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNTc4NjYsImV4cCI6MjEwNTgzMzg2Nn0.Ed4LoLfBbo2Dz1hjmIWz2o2unSsYChjIx2soMdDLNE0",
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
/** When isSyncing was set true — used to unlock a hung sync */
let syncStartedAt = 0;
const SYNC_WATCHDOG_MS = 45_000;

function clearStuckSyncFlag() {
  const s = useSyncStore.getState();
  if (s.isSyncing && syncStartedAt && Date.now() - syncStartedAt > SYNC_WATCHDOG_MS) {
    console.warn("[sync] clearing stuck isSyncing flag");
    useSyncStore.setState({ isSyncing: false });
    syncStartedAt = 0;
  }
}

/** Online dual-write: push pending ops to cloud quickly (silent) */
function scheduleBackgroundSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    clearStuckSyncFlag();
    const s = useSyncStore.getState();
    const online = typeof navigator !== "undefined" ? navigator.onLine : s.isOnline;
    if (online !== s.isOnline) s.setOnline(online);
    if (online && isCloudReady(s.cloud) && !useSyncStore.getState().isSyncing) {
      void s.syncNow({ silent: true });
    }
  }, 120);
}

/** Force a full pull+push (used on focus / login / mobile resume) */
export function forceCloudSync(opts?: { silent?: boolean }) {
  clearStuckSyncFlag();
  const s = useSyncStore.getState();
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (online !== s.isOnline) s.setOnline(online);
  if (!online) return Promise.resolve({ ok: false, message: "Offline" });
  if (!isCloudReady(s.cloud)) {
    // Ensure defaults / enabled
    s.setCloud({ enabled: true });
  }
  // If still marked syncing after watchdog clear, force unlock
  if (useSyncStore.getState().isSyncing) {
    useSyncStore.setState({ isSyncing: false });
    syncStartedAt = 0;
  }
  return useSyncStore.getState().syncNow({ silent: opts?.silent !== false });
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      isSyncing: false,
      deviceId: typeof window !== "undefined" ? getDeviceId() : "server",
      cloud: {
        enabled: true,
        supabase_url: env.supabase_url || PROJECT_DEFAULTS.supabase_url,
        supabase_anon_key: env.supabase_anon_key || PROJECT_DEFAULTS.supabase_anon_key,
        last_sync_at: undefined,
        last_sync_error: undefined,
      },
      pendingOps: [],
      lastFailureDetail: undefined,

      setOnline: (v) => set({ isOnline: v }),

      setCloud: (patch) => set({ cloud: { ...get().cloud, ...patch } }),

      enqueue: (type, payload) => {
        const op: PendingOp = {
          id: uid(),
          type,
          payload,
          created_at: new Date().toISOString(),
          device_id: get().deviceId || getDeviceId(),
          status: "pending",
          retries: 0,
        };
        set({ pendingOps: [...get().pendingOps, op] });
        // Always persist queue locally
        void import("@/db/bridge").then(({ syncPendingOpsToDexie }) => {
          void syncPendingOpsToDexie(get().pendingOps);
        });
        // Online → local already updated by caller; push to cloud immediately (silent)
        if (get().isOnline && isCloudReady(get().cloud)) {
          scheduleBackgroundSync();
        }
      },

      removeOps: (ids) =>
        set({
          pendingOps: get().pendingOps.filter((o) => !ids.includes(o.id)),
        }),

      updateFailedOps: (failed) => {
        const map = new Map(failed.map((f) => [f.id, f]));
        set({
          pendingOps: get().pendingOps.map((o) => map.get(o.id) || o),
        });
      },

      clearFailedOps: () =>
        set({
          pendingOps: get().pendingOps.filter((o) => o.status !== "failed"),
          lastFailureDetail: undefined,
          cloud: { ...get().cloud, last_sync_error: undefined },
        }),

      pendingCount: () =>
        get().pendingOps.filter((o) => o.status === "pending" || o.status === "failed")
          .length,

      syncNow: async (opts) => {
        const isSilent = opts?.silent === true;
        const { cloud, pendingOps } = get();

        // Always trust the browser online flag (fixes stale isOnline after hours)
        const navOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        if (navOnline !== get().isOnline) set({ isOnline: navOnline });
        if (!navOnline) {
          const message = "Device is offline — will sync when online";
          if (!isSilent) {
            set({ cloud: { ...get().cloud, last_sync_error: message } });
          }
          return { ok: false, message };
        }
        if (!isCloudReady(cloud)) {
          // Re-enable defaults if config was cleared
          set({
            cloud: {
              ...cloud,
              enabled: true,
              supabase_url: cloud.supabase_url || "https://neuducaticwvhqwfsept.supabase.co",
            },
          });
          if (!isCloudReady(get().cloud)) {
            const message = "Cloud not configured. Add Supabase URL + key in Settings.";
            return { ok: false, message };
          }
        }
        // Unlock hung sync (e.g. tab slept mid-request)
        if (get().isSyncing) {
          if (syncStartedAt && Date.now() - syncStartedAt > SYNC_WATCHDOG_MS) {
            set({ isSyncing: false });
            syncStartedAt = 0;
          } else {
            return { ok: false, message: "Sync already in progress" };
          }
        }

        set({ isSyncing: true });
        syncStartedAt = Date.now();
        try {
          const reachable = await probeCloud(cloud);
          if (!reachable) {
            const message =
              "Cannot reach Supabase. Check internet, URL, or project status.";
            syncStartedAt = 0;
            set({
              isSyncing: false,
              lastFailureDetail: message,
              cloud: isSilent ? get().cloud : { ...cloud, last_sync_error: message },
            });
            return { ok: false, message };
          }

          const toPush = pendingOps.filter(
            (o) => o.status === "pending" || (o.status === "failed" && (o.retries || 0) < 8)
          );

          const { syncedIds, failed } = await flushQueue(cloud, toPush);
          if (syncedIds.length) get().removeOps(syncedIds);

          if (failed.length) {
            const keep: PendingOp[] = [];
            const drop: string[] = [];
            for (const f of failed) {
              // Permanent or max retries → drop from queue (sale already local)
              if ((f.retries || 0) >= 8) drop.push(f.id);
              else keep.push(f);
            }
            if (drop.length) get().removeOps(drop);
            if (keep.length) get().updateFailedOps(keep);
          }

          let pullError: string | undefined;
          try {
            const snap = await pullAllRemote(cloud);
            if (snap.errors.length) {
              pullError = snap.errors.slice(0, 2).join(" · ");
            }
            const { useAppStore } = await import("@/stores/appStore");
            const local = useAppStore.getState();

            // Seed cloud once: main till has data, cloud tables empty
            // Skip seeding right after system reset so reports/dashboard stay empty
            let skipSeed = false;
            try {
              const resetAt = Number(localStorage.getItem("barpos-reset-at") || "0");
              if (resetAt && Date.now() - resetAt < 3 * 60 * 1000) skipSeed = true;
            } catch { /* ignore */ }

            const seedOps: { type: string; payload: unknown }[] = [];
            // Do NOT seed products when cloud is empty — that undoes "delete all products" / reset
            // on other devices. New products still upload via pending product_upsert ops.

            if (!skipSeed && !(snap.users?.length) && (local.users?.length || 0) > 0) {
              for (const u of local.users) {
                seedOps.push({ type: "user_upsert", payload: u });
              }
            }
            // Do NOT seed historical sales when cloud is empty — that undoes system
            // reset and re-fills Dashboard/Reports. New sales still push via pending ops.
            if (seedOps.length) {
              for (const op of seedOps) {
                get().enqueue(op.type as import("@/types/sync").PendingOpType, op.payload);
              }
              const again = get().pendingOps.filter(
                (o) => o.status === "pending" || o.status === "failed"
              );
              const { syncedIds: seeded } = await flushQueue(cloud, again);
              if (seeded.length) get().removeOps(seeded);
              // Re-pull after seeding so other devices will get the same rows
              const snap2 = await pullAllRemote(cloud);
              await applyRemoteSnapshot(
                snap2,
                () => useAppStore.getState(),
                (patch) => useAppStore.setState(patch)
              );
            } else {
              await applyRemoteSnapshot(
                snap,
                () => useAppStore.getState(),
                (patch) => useAppStore.setState(patch)
              );
            }
          } catch (e) {
            pullError = e instanceof Error ? e.message : "Pull failed";
          }

          const stillFailed = get().pendingOps.filter((o) => o.status === "failed");
          const detail =
            stillFailed[0]?.last_error ||
            pullError ||
            (failed.length ? `${failed.length} op(s) failed` : undefined);

          syncStartedAt = 0;
          set({
            isSyncing: false,
            lastFailureDetail: detail,
            cloud: {
              ...get().cloud,
              last_sync_at: new Date().toISOString(),
              last_sync_error:
                failed.length || pullError
                  ? [
                      failed.length ? `${failed.length} push failed (retrying)` : null,
                      pullError ? `Pull: ${pullError}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : undefined,
            },
          });

          if (!failed.length && !pullError) {
            set({
              lastFailureDetail: undefined,
              cloud: {
                ...get().cloud,
                last_sync_at: new Date().toISOString(),
                last_sync_error: undefined,
              },
            });
          }

          const message = failed.length
            ? `Synced ${syncedIds.length}, ${failed.length} will retry — ${detail || "see Settings"}`
            : pullError
            ? `Pushed OK; product pull issue: ${pullError}`
            : syncedIds.length
            ? `Synced ${syncedIds.length} change(s)`
            : "Already in sync";

          return { ok: failed.length === 0 && !pullError, message };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Sync failed";
          syncStartedAt = 0;
          set({
            isSyncing: false,
            lastFailureDetail: msg,
            cloud: isSilent ? get().cloud : { ...get().cloud, last_sync_error: msg },
          });
          return { ok: false, message: msg };
        }
      },
    }),
    {
      name: "barpos-sync-v1",
      partialize: (s) => ({
        cloud: s.cloud,
        pendingOps: s.pendingOps,
        deviceId: s.deviceId,
      }),
      merge: (persisted, current) => {
        const p = (persisted as Partial<SyncState>) || {};
        const cloud = {
          ...current.cloud,
          ...(p.cloud || {}),
        };
        if (!cloud.supabase_url) {
          cloud.supabase_url = PROJECT_DEFAULTS.supabase_url;
          cloud.supabase_anon_key = PROJECT_DEFAULTS.supabase_anon_key;
          cloud.enabled = true;
        }
        return {
          ...current,
          ...p,
          cloud,
          pendingOps: p.pendingOps || current.pendingOps,
          deviceId: p.deviceId || current.deviceId,
        };
      },
    }
  )
);

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    useSyncStore.getState().setOnline(true);
    scheduleBackgroundSync();
  });
  window.addEventListener("offline", () => {
    useSyncStore.getState().setOnline(false);
  });

  // Always push+pull while online so other devices keep latest data (not only when queue has ops)
  if (!intervalId) {
    intervalId = setInterval(() => {
      clearStuckSyncFlag();
      const s = useSyncStore.getState();
      const online = typeof navigator !== "undefined" ? navigator.onLine : s.isOnline;
      if (online !== s.isOnline) s.setOnline(online);
      if (online && isCloudReady(s.cloud)) {
        void forceCloudSync({ silent: true });
      }
    }, 8000);  // faster multi-device pull (~8s)
  }

  // Mobile browsers freeze timers in background — sync hard on resume
  const resumeSync = () => {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    void forceCloudSync({ silent: true });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeSync();
  });
  window.addEventListener("focus", resumeSync);
  window.addEventListener("pageshow", resumeSync);
}

export function enqueueSync(type: PendingOpType, payload: unknown) {
  useSyncStore.getState().enqueue(type, payload);
}
