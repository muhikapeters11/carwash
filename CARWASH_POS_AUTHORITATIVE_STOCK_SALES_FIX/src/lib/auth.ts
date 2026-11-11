import { isSupabaseConfigured, supabaseUrl, supabaseAnonKey } from './supabase';
import { allowDemoMode } from './config';
import { hashPin, verifyPinHash } from './pinHash';
import { rememberOfflineUser, verifyOfflinePin } from './offlineAuth';
import type { UserProfile } from '../types';

export type LoginResult =
  | { ok: true; user: UserProfile }
  | { ok: false; error: string };

/** Demo users — only when VITE_ALLOW_DEMO=true or local dev. */
export const DEMO_PIN_ADMIN = '482916';
export const DEMO_PIN_CASHIER = '739154';

export async function buildDemoUsers(): Promise<UserProfile[]> {
  const adminHash = await hashPin(DEMO_PIN_ADMIN);
  const cashierHash = await hashPin(DEMO_PIN_CASHIER);
  return [
    {
      id: 'admin-1',
      email: 'admin@pub.local',
      pin: '',
      pin_hash: adminHash,
      role: 'admin',
      full_name: 'Admin User',
      permissions: [
        'dashboard', 'sell', 'receive', 'products', 'inventory',
        'credit', 'expenses', 'reports', 'users', 'activity', 'settings',
      ],
      is_active: true,
    },
    {
      id: 'cashier-1',
      email: 'cashier@pub.local',
      pin: '',
      pin_hash: cashierHash,
      role: 'cashier',
      full_name: 'Cashier One',
      permissions: ['dashboard', 'sell', 'inventory', 'credit', 'expenses', 'receive'],
      is_active: true,
    },
  ];
}

async function tryLocalStaff(pin: string, localStaff: UserProfile[]): Promise<UserProfile | null> {
  for (const u of localStaff) {
    if (u.is_active === false) continue;
    if (u.pin_hash) {
      if (await verifyPinHash(pin, u.pin_hash)) return { ...u, pin: '' };
    } else if (u.pin && u.pin === pin) {
      return { ...u, pin: '' };
    }
  }
  return null;
}

function mapCloudUser(u: Record<string, unknown>): UserProfile {
  return {
    id: String(u.id),
    email: String(u.email || ''),
    pin: '',
    pin_hash: undefined,
    role: u.role === 'admin' ? 'admin' : 'cashier',
    full_name: String(u.full_name || 'User'),
    permissions: Array.isArray(u.permissions) ? (u.permissions as string[]) : [],
    is_active: true,
  };
}

/**
 * Direct REST call to login_with_pin — avoids supabase-js RPC wrapper issues
 * that surface as TypeError: Failed to fetch in some browsers/hosts.
 */
async function cloudLoginWithPin(pin: string): Promise<LoginResult> {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/login_with_pin`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ p_pin: pin }),
    });

    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      return {
        ok: false,
        error: `Login server returned non-JSON (${res.status}). Re-run FIX_LOGIN_RPC_GRANT.sql in Supabase.`,
      };
    }

    if (!res.ok) {
      // PostgREST error object
      const msg = data?.message || data?.error || raw.slice(0, 180) || `HTTP ${res.status}`;
      if (res.status === 404 || /could not find.*function|PGRST202/i.test(String(msg))) {
        return {
          ok: false,
          error: 'login_with_pin is missing. Run supabase/FIX_LOGIN_RPC_GRANT.sql in the SQL Editor.',
        };
      }
      return { ok: false, error: `Login service error: ${msg}` };
    }

    if (data?.ok === true && data.user?.id) {
      return { ok: true, user: mapCloudUser(data.user as Record<string, unknown>) };
    }
    if (data?.ok === false) {
      return { ok: false, error: String(data.error || 'Invalid PIN') };
    }
    return {
      ok: false,
      error: 'Unexpected login response. Run FIX_LOGIN_RPC_GRANT.sql in Supabase.',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Login timed out. Check your internet connection.' };
    }
    const msg = String(err?.message || err || 'Failed to fetch');
    return {
      ok: false,
      error: `Cannot reach ${supabaseUrl} (${msg}). Check network / DNS / ad-blockers.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cloud-first login. Network failures fall back to offline cache / local staff.
 * Explicit Invalid PIN from the server is never overridden by local cache.
 */
export async function loginWithPin(
  pin: string,
  localStaff: UserProfile[]
): Promise<LoginResult> {
  if (!/^\d{6}$/.test(pin)) {
    return { ok: false, error: 'Enter your six-digit PIN' };
  }

  if (isSupabaseConfigured) {
    const cloud = await cloudLoginWithPin(pin);

    if (cloud.ok) {
      await rememberOfflineUser(cloud.user, pin);
      return cloud;
    }

    // Authoritative rejection — do not use stale offline PIN.
    if (/invalid pin/i.test(cloud.error || '')) {
      return cloud;
    }

    // Network / deployment errors → offline cache, then local staff.
    const cached = await verifyOfflinePin(pin);
    if (cached) {
      await rememberOfflineUser(cached, pin);
      return { ok: true, user: cached };
    }
    const local = await tryLocalStaff(pin, localStaff);
    if (local) {
      await rememberOfflineUser(local, pin);
      return { ok: true, user: local };
    }
    return cloud;
  }

  const cached = await verifyOfflinePin(pin);
  if (cached) {
    await rememberOfflineUser(cached, pin);
    return { ok: true, user: cached };
  }

  const local = await tryLocalStaff(pin, localStaff);
  if (local) {
    await rememberOfflineUser(local, pin);
    return { ok: true, user: local };
  }

  if (allowDemoMode) {
    const demo = await buildDemoUsers();
    const demoUser = await tryLocalStaff(pin, demo);
    if (demoUser) {
      await rememberOfflineUser(demoUser, pin);
      return { ok: true, user: demoUser };
    }
  }

  return { ok: false, error: 'Invalid PIN' };
}

export async function hashPinForStorage(pin: string): Promise<string> {
  return hashPin(pin);
}
