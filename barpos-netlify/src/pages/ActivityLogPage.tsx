import { useAppStore } from "@/stores/appStore";

export function ActivityLogPage() {
  const logs = useAppStore((s) => s.activityLog);
  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      <h1 className="text-xl font-bold mb-4">Activity Log</h1>
      <div className="bg-white rounded-2xl border divide-y">
        {logs.length === 0 ? (
          <p className="p-6 text-slate-400 text-sm">No activity yet</p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="px-5 py-3 flex justify-between gap-4">
              <div>
                <div className="font-medium text-sm">{l.action}</div>
                {l.details && <div className="text-xs text-slate-500">{l.details}</div>}
                <div className="text-[10px] text-slate-400 mt-0.5">{l.user_name}</div>
              </div>
              <div className="text-xs text-slate-400 whitespace-nowrap">
                {new Date(l.created_at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
