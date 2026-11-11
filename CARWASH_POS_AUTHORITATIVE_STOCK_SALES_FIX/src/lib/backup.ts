/**
 * Full app backup / restore (JSON) + scheduled reminder via localStorage.
 */
import type {
  Product, Sale, Credit, Expense, HeldSale, StockReceive,
  ActivityLogEntry, Notification, AppSettings, UserProfile,
} from '../types';

export const BACKUP_META_KEY = 'pub-pos-last-backup';
export const BACKUP_REMIND_DAYS = 1;

export interface BackupPayload {
  version: number;
  exported_at: string;
  products: Product[];
  sales: Sale[];
  credits: Credit[];
  expenses: Expense[];
  heldSales: HeldSale[];
  stockReceives: StockReceive[];
  activityLogs: ActivityLogEntry[];
  notifications: Notification[];
  settings: AppSettings;
  staffUsers: UserProfile[];
}

export function buildBackup(state: {
  products: Product[];
  sales: Sale[];
  credits: Credit[];
  expenses: Expense[];
  heldSales: HeldSale[];
  stockReceives: StockReceive[];
  activityLogs: ActivityLogEntry[];
  notifications: Notification[];
  settings: AppSettings;
  staffUsers: UserProfile[];
}): BackupPayload {
  // Never export plain PINs
  const staffUsers = state.staffUsers.map((u) => ({
    ...u,
    pin: '',
  }));
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    products: state.products,
    sales: state.sales,
    credits: state.credits,
    expenses: state.expenses,
    heldSales: state.heldSales,
    stockReceives: state.stockReceives,
    activityLogs: state.activityLogs,
    notifications: state.notifications,
    settings: state.settings,
    staffUsers,
  };
}

export function downloadBackupJson(payload: BackupPayload, filename?: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `pub-pos-backup-${payload.exported_at.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(BACKUP_META_KEY, new Date().toISOString());
}

export function parseBackupFile(text: string): BackupPayload | null {
  try {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.products)) return null;
    return data as BackupPayload;
  } catch {
    return null;
  }
}

export function daysSinceLastBackup(): number | null {
  const raw = localStorage.getItem(BACKUP_META_KEY);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

export function shouldRemindBackup(): boolean {
  const d = daysSinceLastBackup();
  if (d === null) return true;
  return d >= BACKUP_REMIND_DAYS;
}
