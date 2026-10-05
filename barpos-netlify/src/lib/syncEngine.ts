/** @deprecated import from @/lib/sync — kept for existing imports */
export {
  pushPendingOp,
  pullRemoteCatalog,
  flushQueue,
  mergeCatalog,
  mergeProductLWW,
  classifySyncError,
  humanSyncError,
  isRetryableError,
} from "@/lib/sync";
export type { PushResult, SyncErrorKind } from "@/lib/sync";
