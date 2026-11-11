import React, { useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, ShoppingCart, PackagePlus, Package,
  ClipboardList, CreditCard, Receipt, BarChart3,
  Users, Activity, Settings, LogOut, Bell, Menu, X, RefreshCw
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { TabId } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

const ALL_TABS: { id: TabId; label: string; short?: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: <LayoutDashboard size={20} /> },
  { id: 'sell', label: 'Sell', short: 'Sell', icon: <ShoppingCart size={20} /> },
  { id: 'receive', label: 'Receive Stock', short: 'Receive', icon: <PackagePlus size={20} /> },
  { id: 'products', label: 'Products', short: 'Products', icon: <Package size={20} /> },
  { id: 'inventory', label: 'Inventory Audit', short: 'Audit', icon: <ClipboardList size={20} /> },
  { id: 'credit', label: 'Credit', short: 'Credit', icon: <CreditCard size={20} /> },
  { id: 'expenses', label: 'Expenses', short: 'Expenses', icon: <Receipt size={20} /> },
  { id: 'reports', label: 'Reports', short: 'Reports', icon: <BarChart3 size={20} /> },
  { id: 'users', label: 'Users', short: 'Users', icon: <Users size={20} />, adminOnly: true },
  { id: 'activity', label: 'Activity Log', short: 'Log', icon: <Activity size={20} /> },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: <Settings size={20} />, adminOnly: true },
];

const IDLE_MS = 10 * 60 * 1000; // 10 minutes

export default function Layout({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser)!;
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const notifications = useStore((s) => s.notifications);
  const markNotificationRead = useStore((s) => s.markNotificationRead);
  const settings = useStore((s) => s.settings);
  const theme = useStore((s) => s.theme);
  const [showNotifs, setShowNotifs] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [online, setOnline] = React.useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  const [syncing, setSyncing] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const syncStatus = (event: Event) => {
      const active = Boolean((event as CustomEvent).detail?.syncing);
      setSyncing(active);
      if (!active) setRefreshing(false);
    };
    window.addEventListener('pub-pos-sync-status', syncStatus);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('pub-pos-sync-status', syncStatus);
    };
  }, []);

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setCurrentUser(null);
    }, IDLE_MS);
  }, [setCurrentUser]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((e) => window.addEventListener(e, resetIdle));
    resetIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdle]);

  useEffect(() => {
    // Admins can open any tab. Only redirect cashiers when permissions are known
    // and the current tab is truly not allowed — never bounce on empty/undefined
    // permissions during a sync race.
    if (currentUser.role === 'admin') return;
    const perms = currentUser.permissions;
    if (!Array.isArray(perms) || perms.length === 0) return;
    if (!perms.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [currentUser.role, currentUser.permissions, activeTab, setActiveTab]);

  // Close drawer when tab changes on mobile
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeTab]);

  const visibleTabs = ALL_TABS.filter((t) => {
    if (currentUser.role === 'admin') return true;
    if (t.adminOnly) return false;
    return currentUser.permissions.includes(t.id);
  });

  // Primary tabs in bottom bar (max ~5); rest in "More" drawer
  const primaryIds: TabId[] = ['dashboard', 'sell', 'receive', 'credit', 'inventory'];
  const primaryTabs = visibleTabs.filter((t) => primaryIds.includes(t.id)).slice(0, 4);
  const moreTabs = visibleTabs.filter((t) => !primaryTabs.some((p) => p.id === t.id));

  const unread = notifications.filter((n) => !n.is_read).length;

  const navButton = (tab: (typeof ALL_TABS)[0], compact = false) => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`flex items-center gap-3 text-left font-medium transition-colors touch-manipulation ${
        compact
          ? `flex-col justify-center gap-0.5 px-1 py-2 text-[10px] min-w-0 flex-1 ${
              activeTab === tab.id
                ? 'text-primary-600'
                : theme === 'dark'
                ? 'text-gray-400'
                : 'text-gray-500'
            }`
          : `w-full px-4 py-3 text-sm ${
              activeTab === tab.id
                ? 'bg-primary-50 text-primary-700 border-r-4 border-primary-600'
                : theme === 'dark'
                ? 'text-gray-300 hover:bg-gray-700'
                : 'text-gray-600 hover:bg-gray-50'
            }`
      }`}
    >
      <span className={compact && activeTab === tab.id ? 'text-primary-600' : ''}>{tab.icon}</span>
      <span className={compact ? 'truncate w-full text-center' : ''}>
        {compact ? tab.short || tab.label : tab.label}
      </span>
    </button>
  );

  return (
    <div
      className={`h-[100dvh] flex flex-col overflow-hidden ${
        theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-gray-100'
      }`}
    >
      {/* Top bar */}
      <header className="h-14 shrink-0 bg-pub-dark text-white flex items-center justify-between px-3 sm:px-4 shadow-md z-20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {isMobile && (
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="p-2 rounded-lg hover:bg-white/10 touch-manipulation"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          )}
          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-pub-gold shrink-0">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="text-lg">🍺</span>
            )}
          </div>
          <span className="text-base sm:text-lg font-bold tracking-wide truncate">{settings.pub_name}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {currentUser.role === 'admin' && (
            <div className="relative">
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                className="relative p-2 rounded-full hover:bg-white/10 touch-manipulation"
              >
                <Bell size={20} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-xs w-5 h-5 rounded-full flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white text-gray-800 rounded-xl shadow-2xl border max-h-96 overflow-y-auto z-50">
                  <div className="p-3 border-b font-semibold flex justify-between">
                    Notifications
                    <button
                      className="text-xs text-primary-600"
                      onClick={() => {
                        useStore.getState().markAllRead();
                        setShowNotifs(false);
                      }}
                    >
                      Mark all read
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="p-4 text-gray-500 text-sm">No notifications</p>
                  ) : (
                    notifications.slice(0, 20).map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          markNotificationRead(n.id);
                          setShowNotifs(false);
                        }}
                        className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50' : ''}`}
                      >
                        <div className="font-medium text-sm">{n.title}</div>
                        <div className="text-xs text-gray-600">{n.message}</div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          {/* Connectivity: green = online, red = offline */}
          <span
            className="inline-flex items-center shrink-0"
            title={online ? 'Online' : 'Offline'}
            aria-label={online ? 'Online' : 'Offline'}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                online ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
          </span>
          {/* Sync status next to refresh: yellow = idle, pink (pulse) = syncing */}
          <span
            className="inline-flex items-center shrink-0"
            title={syncing ? 'Syncing…' : 'Not syncing'}
            aria-label={syncing ? 'Syncing' : 'Not syncing'}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                syncing ? 'bg-pink-500 animate-pulse' : 'bg-yellow-400'
              }`}
            />
          </span>
          <button
            onClick={() => {
              setRefreshing(true);
              window.dispatchEvent(new CustomEvent('pub-pos-refresh'));
              // Spin only while this manual refresh is in flight; sync status
              // events will clear the flag when the pull finishes.
              window.setTimeout(() => setRefreshing(false), 8000);
            }}
            className="p-2 rounded-lg hover:bg-white/10 touch-manipulation"
            title="Refresh data"
            aria-label="Refresh data"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <span className="text-sm text-white/80 hidden xs:inline sm:inline max-w-[8rem] truncate">
            {currentUser.full_name}
          </span>
        </div>
      </header>

      {!online && (
        <div className="bg-amber-500 text-amber-950 text-center text-sm font-medium px-3 py-1.5">
          Offline — sales are saved on this device and will sync when you are back online
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop side nav */}
        {!isMobile && (
          <nav
            className={`w-52 border-r flex flex-col py-2 shadow-sm shrink-0 ${
              theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex-1 overflow-y-auto">{visibleTabs.map((t) => navButton(t))}</div>
            <div className="border-t p-2">
              <button
                onClick={() => setCurrentUser(null)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg"
              >
                <LogOut size={20} />
                Logout
              </button>
            </div>
          </nav>
        )}

        {/* Mobile slide-out menu (all tabs + logout) */}
        {isMobile && mobileMenuOpen && (
          <>
            <div
              className="absolute inset-0 bg-black/40 z-30"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav
              className={`absolute left-0 top-0 bottom-0 w-64 z-40 flex flex-col shadow-2xl ${
                theme === 'dark' ? 'bg-gray-800' : 'bg-white'
              }`}
            >
              <div className="p-4 border-b font-semibold flex justify-between items-center">
                Menu
                <button onClick={() => setMobileMenuOpen(false)} className="p-1">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">{visibleTabs.map((t) => navButton(t))}</div>
              <div className="border-t p-2">
                <button
                  onClick={() => setCurrentUser(null)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <LogOut size={20} />
                  Logout
                </button>
              </div>
            </nav>
          </>
        )}

        {/* Main content — extra bottom padding on mobile for bottom nav */}
        <main
          className={`flex-1 overflow-auto p-3 sm:p-4 ${isMobile ? 'pb-20' : ''}`}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {isMobile && (
        <nav
          className={`shrink-0 border-t flex items-stretch safe-area-pb z-20 ${
            theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {primaryTabs.map((t) => navButton(t, true))}
          {moreTabs.length > 0 && (
            <button
              onClick={() => setMobileMenuOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] flex-1 min-w-0 ${
                moreTabs.some((t) => t.id === activeTab)
                  ? 'text-primary-600'
                  : theme === 'dark'
                  ? 'text-gray-400'
                  : 'text-gray-500'
              }`}
            >
              <Menu size={20} />
              <span>More</span>
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
