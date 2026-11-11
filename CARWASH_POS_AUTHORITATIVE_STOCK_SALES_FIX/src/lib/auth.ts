import { supabase, isSupabaseConfigured } from './supabase';
import { allowDemoMode } from './config';
import { hashPin, verifyPinHash } from './pinHash';
import { isOnline } from './offline';
import { rememberOfflineUser, verifyOfflinePin } from './offlineAuth';
import type { UserProfile } from '../types';

export type LoginResult =
  | { ok: true; user: UserProfile }
  | { ok: false; error: string };

/** Demo users — only when VITE_ALLOW_DEMO=true or local dev. PINs are non-default. */
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
      if (await verifyPinHash(pin, u.pin_hash)) {
        return { ...u, pin: '' };
      }
    } else if (u.pin && u.pin === pin) {
      return { ...u, pin: '' };
    }
  }
  return null;
}

/**
 * Authenticate against the cloud first whenever this installation is configured
 * for Supabase. The cloud profile is authoritative after a factory reset: local
 * profiles and cached PINs may have been deleted or may be stale on another till.
 * Local credentials are used only when the device is offline or the RPC cannot
 * be reached (never when the server explicitly rejects the PIN).
 */
export async function loginWithPin(
  pin: string,
  localStaff: UserProfile[]
): Promise<LoginResult> {
  if (!/^\d{6}$/.test(pin)) {
    return { ok: false, error: 'Enter your six-digit PIN' };
  }

  const online = isOnline();

  // Cloud is the source of truth in a configured production installation.
  if (isSupabaseConfigured && online) {
    try {
      const rpcPromise = supabase.rpc('login_with_pin', { p_pin: pin });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Login server timed out. Check your internet connection and try again.')), 12000);
      });
      let result: { data: unknown; error: any };
      try {
        result = await Promise.race([rpcPromise, timeoutPromise]) as { data: unknown; error: any };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (result.error) {
        // A missing function / permission / SQL error is a deployment problem,
        // not evidence that the PIN is wrong. Do not mask it with local auth.
        const message = String(result.error.message || 'Could not contact login service');
        return { ok: false, error: `Login service error: ${message}` };
      }

      const payload = result.data as any;
      if (payload?.ok === true && payload.user?.id) {
        const u = payload.user as Record<string, unknown>;
        const user: UserProfile = {
          id: String(u.id),
          email: String(u.email || ''),
          pin: '',
          pin_hash: undefined,
          role: u.role === 'admin' ? 'admin' : 'cashier',
          full_name: String(u.full_name || 'User'),
          permissions: Array.isArray(u.permissions) ? u.permissions as string[] : [],
          is_active: true,
        };
        // Cache only a user that the cloud has just authenticated.
        await rememberOfflineUser(user, pin);
        return { ok: true, user };
      }

      // An explicit negative response is authoritative. Do not allow a stale
      // offline PIN or cached profile to override a cloud rejection.
      if (payload?.ok === false) {
        return { ok: false, error: String(payload.error || 'Invalid PIN') };
      }
      return { ok: false, error: 'The login server returned an unexpected response. Check the Supabase SQL setup.' };
    } catch (error: any) {
      // If the browser still reports online but the RPC cannot be reached,
      // allow a previously verified offline account as a controlled fallback.
      const cached = await verifyOfflinePin(pin);
      if (cached) {
        await rememberOfflineUser(cached, pin);
        return { ok: true, user: cached };
      }
      return { ok: false, error: error?.message || 'Unable to reach the login server. Check your connection and try again.' };
    }
  }

  // Offline mode: use only previously verified cached credentials, then local
  // staff records for a deliberate local/demo installation.
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

  return { ok: false, error: online ? 'Invalid PIN' : 'Invalid PIN (offline)' };
}

export async function hashPinForStorage(pin: string): Promise<string> {
  return hashPin(pin);
}
