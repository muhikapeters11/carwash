/** Modular sync error classification and messaging */

export type SyncErrorKind = "transient" | "permanent" | "conflict" | "unknown";

export type PushResult = {
  ok: boolean;
  error?: string;
  kind?: SyncErrorKind;
  status?: number;
};

export function classifySyncError(
  error: string | undefined | null,
  status?: number
): SyncErrorKind {
  if (status === 401 || status === 403 || status === 404) return "permanent";
  if (status === 409) return "conflict";
  if (status === 0 || status === 408 || status === 429) return "transient";
  if (status && status >= 500) return "transient";

  const e = (error || "").toLowerCase();
  if (!e) return "unknown";
  if (
    /network|failed to fetch|timeout|offline|econnrefused|abort/.test(e)
  ) {
    return "transient";
  }
  if (
    /jwt|unauthorized|permission|row-level|does not exist|schema cache|invalid api key/.test(
      e
    )
  ) {
    return "permanent";
  }
  if (/duplicate|unique|conflict|already exists/.test(e)) return "conflict";
  if (/version|row was updated|check constraint/.test(e)) return "conflict";
  return "unknown";
}

export function isRetryableError(
  kind: SyncErrorKind,
  retries: number,
  max = 8
): boolean {
  if (kind === "conflict" || kind === "permanent") return false;
  if (retries >= max) return false;
  return true;
}

export function humanSyncError(error: string, kind: SyncErrorKind): string {
  const short = error.replace(/\s+/g, " ").slice(0, 100);
  switch (kind) {
    case "transient":
      return `Temporary — will retry. (${short})`;
    case "permanent":
      return `Setup/auth issue — check Supabase URL, key, schema. (${short})`;
    case "conflict":
      return `Already on server or version conflict (OK to skip).`;
    default:
      return short || "Unknown sync error";
  }
}

/** Normalize any thrown/HTTP failure into PushResult */
export function toPushFailure(
  error: string,
  status?: number
): PushResult {
  const kind = classifySyncError(error, status);
  if (kind === "conflict") {
    return { ok: true, kind, status, error: humanSyncError(error, kind) };
  }
  return {
    ok: false,
    kind,
    status,
    error: humanSyncError(error, kind),
  };
}
