/**
 * Offline login cache — stores hashed PINs after a successful online login
 * so the till works with no internet using the last known users.
 */
import { hashPin, verifyPinHash } from './pinHash';
import type { UserProfile } from '../types';

const KEY = 'pub-pos-offline-auth';

export type OfflineAuthEntry = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'cashier';
  permissions: string[];
  is_active: boolean;
  /** SHA-256 of the 6-digit PIN (client-side). Never plain PIN. */
  pin_hash: string;
};

function load(): OfflineAuthEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list: OfflineAuthEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* quota */
  }
}

/** Remember this user after a successful login (online or offline). */
export async function rememberOfflineUser(user: UserProfile, plainPin: string): Promise<void> {
  if (!/^\d{6}$/.test(plainPin)) return;
  const pin_hash = await hashPin(plainPin);
  const list = load().filter((e) => e.id !== user.id);
  list.push({
    id: user.id,
    email: user.email || '',
    full_name: user.full_name || 'User',
    role: user.role === 'admin' ? 'admin' : 'cashier',
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    is_active: user.is_active !== false,
    pin_hash,
  });
  save(list);
}

export async function verifyOfflinePin(pin: string): Promise<UserProfile | null> {
  if (!/^\d{6}$/.test(pin)) return null;
  for (const e of load()) {
    if (e.is_active === false) continue;
    if (await verifyPinHash(pin, e.pin_hash)) {
      return {
        id: e.id,
        email: e.email,
        pin: '',
        pin_hash: e.pin_hash,
        role: e.role,
        full_name: e.full_name,
        permissions: e.permissions,
        is_active: true,
      };
    }
  }
  return null;
}

export function clearOfflineAuth(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function listOfflineAuthCount(): number {
  return load().length;
}
