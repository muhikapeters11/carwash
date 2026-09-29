import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface POSLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  className?: string;
}

/**
 * Classic 3-column POS layout optimized for touch screens.
 * Left  : Categories / Menu
 * Center: Order ticket
 * Right : Actions / Payment / Numpad
 */
export function POSLayout({ left, center, right, className }: POSLayoutProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full bg-slate-100 text-slate-900 overflow-hidden",
        className
      )}
    >
      {/* Left panel - Menu */}
      <aside className="w-[32%] min-w-[280px] max-w-[420px] border-r border-slate-200 bg-white flex flex-col">
        {left}
      </aside>

      {/* Center - Current Order */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
        {center}
      </main>

      {/* Right - Actions */}
      <aside className="w-[28%] min-w-[260px] max-w-[360px] border-l border-slate-200 bg-white flex flex-col">
        {right}
      </aside>
    </div>
  );
}
