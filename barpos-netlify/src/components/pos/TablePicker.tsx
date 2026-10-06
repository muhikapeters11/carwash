import { useOrderStore } from "@/stores/orderStore";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

const TABLES = [
  "Bar 1", "Bar 2", "Bar 3", "Bar 4", "Bar 5",
  "Table 1", "Table 2", "Table 3", "Table 4", "Table 5",
  "Table 6", "Table 7", "Table 8", "Table 9", "Table 10",
  "Patio 1", "Patio 2", "Takeaway", "Delivery",
];

export function TablePicker() {
  const show = useOrderStore((s) => s.showTablePicker);
  const setShow = useOrderStore((s) => s.setShowTablePicker);
  const currentOrder = useOrderStore((s) => s.currentOrder);
  const setTableLabel = useOrderStore((s) => s.setTableLabel);
  const startNewOrder = useOrderStore((s) => s.startNewOrder);

  if (!show) return null;

  const handleSelect = (label: string) => {
    if (currentOrder) {
      setTableLabel(label);
    } else {
      startNewOrder(label);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">Select Table / Location</h2>
          <button
            onClick={() => setShow(false)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2">
            {TABLES.map((table) => {
              const isActive = currentOrder?.table_label === table;
              return (
                <button
                  key={table}
                  onClick={() => handleSelect(table)}
                  className={cn(
                    "py-4 px-2 rounded-xl text-sm font-semibold border-2 transition active:scale-95",
                    isActive
                      ? "bg-amber-500 border-amber-500 text-white shadow-md"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-amber-400 hover:bg-amber-50"
                  )}
                >
                  {table}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
