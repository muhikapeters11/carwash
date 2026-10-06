import { useSyncStore } from "@/stores/syncStore";
import { CloudOff } from "lucide-react";

/** Only visible when offline — sync runs silently in background */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  if (isOnline) return null;
  return (
    <div className="shrink-0 px-3 py-1.5 text-xs font-medium flex items-center gap-2 bg-amber-500 text-white">
      <CloudOff size={14} />
      <span className="truncate">Offline — saved on this device; will sync when online</span>
    </div>
  );
}
