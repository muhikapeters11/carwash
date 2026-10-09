import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { TAB_LABELS, type AppTab } from "@/types";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Wallet,
  CreditCard, Boxes, BarChart3, Users, Building2,
  ScrollText, Settings, LogOut, Sun, Moon, Menu, X,
} from "lucide-react";

const ICONS: Record<AppTab, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  sell: ShoppingCart,
  inventory: Package,
  receive_stock: Truck,
  expenses: Wallet,
  credits: CreditCard,
  products: Boxes,
  reports: BarChart3,
  suppliers: Building2,
  users: Users,
  activity_log: ScrollText,
  settings: Settings,
};

/** Primary tabs for bottom mobile bar */
const MOBILE_PRIMARY: AppTab[] = ["sell", "receive_stock", "inventory", "reports", "dashboard"];

export function Sidebar() {
  const session = useAppStore((s) => s.session);
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const logout = useAppStore((s) => s.logout);
  const audits = useAppStore((s) => s.stockAudits);
  const stockReceives = useAppStore((s) => s.stockReceives);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!session) return null;

  const tabs = session.allowed_tabs;
  const unseenAudits =
    session.role === "admin"
      ? audits.filter((a) => !a.seen_by_admin).length
      : 0;
  const unseenReceives =
    session.role === "admin" || session.role === "manager"
      ? stockReceives.filter((r) => !r.seen_by_admin && r.received_by !== session.id).length
      : 0;

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" });
  };

  const go = (tab: AppTab) => {
    setActiveTab(tab);
    setDrawerOpen(false);
  };

  const primary = MOBILE_PRIMARY.filter((t) => tabs.includes(t));
  const moreTabs = tabs.filter((t) => !MOBILE_PRIMARY.includes(t));

  const NavButtons = ({ compact = false }: { compact?: boolean }) => (
    <>
      {tabs.map((tab) => {
        const Icon = ICONS[tab];
        const isActive = activeTab === tab;
        return (
          <button
            key={tab}
            onClick={() => go(tab)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left",
              isActive
                ? "bg-amber-500 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white",
              compact && "justify-center px-2"
            )}
          >
            <Icon size={18} />
            {!compact && <span className="flex-1">{TAB_LABELS[tab]}</span>}
            {tab === "inventory" && unseenAudits > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unseenAudits}
              </span>
            )}
            {tab === "receive_stock" && unseenReceives > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unseenReceives}
              </span>
            )}
          </button>
        );
      })}
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-slate-900 text-white flex-col h-full shrink-0">
        <div className="px-4 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            {settings.logo_url ? (
              <img
                src={settings.logo_url}
                alt="Logo"
                className="w-9 h-9 rounded-lg object-cover bg-white shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center font-bold text-sm shrink-0">
                {(settings.business_name || "B").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight truncate">
                {settings.business_name || "Bar POS"}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {session.full_name} · {session.role}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          <NavButtons />
        </nav>

        <div className="p-2 border-t border-slate-700 space-y-1">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            {settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {settings.theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-slate-900 text-white flex items-center px-3 gap-2 border-b border-slate-700">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg hover:bg-slate-800"
          aria-label="Menu"
        >
          <Menu size={22} />
        </button>
        <div className="font-bold text-sm truncate flex-1">
          {settings.business_name || "Bar POS"}
        </div>
        <span className="text-[10px] text-slate-400 truncate max-w-[40%]">
          {session.full_name}
        </span>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-slate-900 text-white flex flex-col shadow-xl">
            <div className="px-4 py-4 border-b border-slate-700 flex items-center justify-between">
              <div className="font-bold">{settings.business_name || "Bar POS"}</div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-2 rounded-lg hover:bg-slate-800">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              <NavButtons />
            </nav>
            <div className="p-2 border-t border-slate-700 space-y-1">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                {settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                {settings.theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                <LogOut size={18} />
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-slate-900 text-white border-t border-slate-700 flex items-stretch safe-bottom">
        {primary.map((tab) => {
          const Icon = ICONS[tab];
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => go(tab)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                isActive ? "text-amber-400" : "text-slate-400"
              )}
            >
              <Icon size={22} />
              <span className="truncate max-w-full px-0.5">{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
        {moreTabs.length > 0 && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400"
          >
            <Menu size={22} />
            <span>More</span>
          </button>
        )}
      </nav>

      {/* Spacer for mobile top bar content */}
      <div className="md:hidden h-12 shrink-0" />
    </>
  );
}
