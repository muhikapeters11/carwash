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

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Online dual-write: push pending ops to cloud quickly (silent) */
function scheduleBackgroundSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const s = useSyncStore.getState();
    if (s.isOnline && isCloudReady(s.cloud) && !s.isSyncing) {
      void s.syncNow({ silent: true });
    }
  }, 120);
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      isSyncing: false,
      deviceId: typeof window !== "undefined" ? getDeviceId() : "server",
      cloud: {
        // Cloud only when VITE_SUPABASE_* env or Settings provides URL + anon key
        enabled: Boolean(env.supabase_url && env.supabase_anon_key),
        supabase_url: env.supabase_url || "",
        supabase_anon_key: env.supabase_anon_key || "",
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
        const { cloud, isOnline } = get();

        if (!isOnline) {
          const message = "Device is offline — will sync when online";
          if (!isSilent) {
            set({ cloud: { ...cloud, last_sync_error: message } });
          }
          return { ok: false, message };
        }
        if (!isCloudReady(cloud)) {
          const message = "Cloud not configured. Add Supabase URL + key in Settings.";
          return { ok: false, message };
        }
        if (get().isSyncing) {
          return { ok: false, message: "Sync already in progress" };
        }

        set({ isSyncing: true });
        try {
          const reachable = await probeCloud(cloud);
          if (!reachable) {
            const message =
              "Cannot reach Supabase. Check internet, URL, or project status.";
            set({
              isSyncing: false,
              lastFailureDetail: message,
              cloud: isSilent ? get().cloud : { ...cloud, last_sync_error: message },
            });
            return { ok: false, message };
          }

          // Read the queue only after connectivity is confirmed. Mutations may
          // have been enqueued while the reachability probe was running.
          const toPush = get().pendingOps.filter(
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
            await applyRemoteSnapshot(
              snap,
              () => useAppStore.getState(),
              (patch) => useAppStore.setState(patch)
            );
          } catch (e) {
            pullError = e instanceof Error ? e.message : "Pull failed";
          }

          const stillFailed = get().pendingOps.filter((o) => o.status === "failed");
          const detail =
            stillFailed[0]?.last_error ||
            pullError ||
            (failed.length ? `${failed.length} op(s) failed` : undefined);

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
        // Prefer env when persisted config is empty (fresh install / cleared storage)
        if (!cloud.supabase_url?.trim() && env.supabase_url) {
          cloud.supabase_url = env.supabase_url;
          cloud.supabase_anon_key = env.supabase_anon_key || "";
          cloud.enabled = Boolean(env.supabase_url && env.supabase_anon_key);
        }
        cloud.enabled = Boolean(
          cloud.enabled && cloud.supabase_url?.trim() && cloud.supabase_anon_key?.trim()
        );
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

  if (!intervalId) {
    intervalId = setInterval(() => {
      const s = useSyncStore.getState();
      if (
        s.isOnline &&
        isCloudReady(s.cloud) &&
        s.pendingOps.some((o) => o.status === "pending" || o.status === "failed")
      ) {
        void s.syncNow({ silent: true });
      }
    }, 20000);
  }
}

export function enqueueSync(type: PendingOpType, payload: unknown) {
  useSyncStore.getState().enqueue(type, payload);
}
