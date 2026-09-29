import type { CloudConfig, PendingOp } from "@/types/sync";
import { isCloudReady, supabaseRest } from "@/lib/supabase";
import type { Product, User } from "@/types";
import {
  isRetryableError,
  humanSyncError,
  classifySyncError,
  type PushResult,
  type SyncErrorKind,
} from "@/lib/sync/errors";
import { dispatchPendingOp } from "@/lib/sync/handlers";
import { mergeCatalog } from "@/lib/sync/merge";

export type { PushResult, SyncErrorKind };
export { mergeCatalog, mergeProductLWW, mergeUsers } from "@/lib/sync/merge";
export { classifySyncError, humanSyncError, isRetryableError } from "@/lib/sync/errors";

export async function pushPendingOp(
  cfg: CloudConfig,
  op: PendingOp
): Promise<PushResult> {
  if (!isCloudReady(cfg)) {
    return { ok: false, error: "Cloud not configured", kind: "permanent" };
  }
  return dispatchPendingOp(cfg, op);
}

export async function pullRemoteCatalog(cfg: CloudConfig): Promise<{
  products?: Product[];
  error?: string;
  kind?: SyncErrorKind;
}> {
  if (!isCloudReady(cfg)) {
    return { error: "Cloud not configured", kind: "permanent" };
  }
  const { data, error, status } = await supabaseRest<Product[]>(cfg, "products", {
    query: "select=*&order=updated_at.desc",
  });
  if (error) {
    const kind = classifySyncError(error, status);
    return { error: humanSyncError(error, kind), kind };
  }
  return { products: data || [] };
}

export async function pullRemoteUsers(cfg: CloudConfig): Promise<{
  users?: User[];
  error?: string;
  kind?: SyncErrorKind;
}> {
  if (!isCloudReady(cfg)) {
    return { error: "Cloud not configured", kind: "permanent" };
  }
  const { data, error, status } = await supabaseRest<User[]>(cfg, "users", {
    query: "select=*",
  });
  if (error) {
    const kind = classifySyncError(error, status);
    return { error: humanSyncError(error, kind), kind };
  }
  return { users: data || [] };
}

export async function flushQueue(
  cfg: CloudConfig,
  ops: PendingOp[],
  onProgress?: (op: PendingOp, result: PushResult) => void
): Promise<{
  syncedIds: string[];
  failed: PendingOp[];
  conflictIds: string[];
}> {
  const syncedIds: string[] = [];
  const conflictIds: string[] = [];
  const failed: PendingOp[] = [];
  const pending = ops.filter((o) => o.status === "pending" || o.status === "failed");

  for (const op of pending) {
    const result = await pushPendingOp(cfg, op);
    onProgress?.(op, result);

    if (result.ok) {
      syncedIds.push(op.id);
      if (result.kind === "conflict") conflictIds.push(op.id);
      continue;
    }

    const retries = (op.retries || 0) + 1;
    const kind = result.kind || "unknown";

    if (kind === "conflict") {
      syncedIds.push(op.id);
      conflictIds.push(op.id);
      continue;
    }

    failed.push({
      ...op,
      status: "failed",
      last_error: result.error,
      retries,
    });

    // Non-retryable permanent errors still stay in failed once so UI can show them;
    // syncStore drops after max retries.
    if (!isRetryableError(kind, retries)) {
      // keep in failed list with high retries so store can drop
      failed[failed.length - 1].retries = Math.max(retries, 8);
    }
  }

  return { syncedIds, failed, conflictIds };
}
