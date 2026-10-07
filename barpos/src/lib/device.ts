const KEY = "barpos-device-id";

/** Stable ID for this browser/device — used in sync and receipts */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "device-unknown";
  }
}
