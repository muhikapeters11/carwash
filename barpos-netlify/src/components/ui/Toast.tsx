import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium animate-in",
            t.type === "success" && "bg-emerald-50 border-emerald-200 text-emerald-900",
            t.type === "error" && "bg-red-50 border-red-200 text-red-900",
            t.type === "info" && "bg-slate-50 border-slate-200 text-slate-800"
          )}
        >
          <span className="mt-0.5 shrink-0">
            {t.type === "success" && <CheckCircle2 size={18} className="text-emerald-600" />}
            {t.type === "error" && <XCircle size={18} className="text-red-600" />}
            {t.type === "info" && <Info size={18} className="text-slate-500" />}
          </span>
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 p-0.5 rounded hover:bg-black/5 text-slate-400"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
