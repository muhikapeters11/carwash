import { isSupabaseConfigured as cloudConfigured } from './supabase';
/** Runtime config — production vs demo / desktop */

const env = import.meta.env;

export const isSupabaseConfigured = cloudConfigured;

/** True when built for Electron (desktop installer). */
export const isElectronBuild = env.VITE_IS_ELECTRON === 'true';

/**
 * Local demo users / offline PIN fallback.
 * - Explicit VITE_ALLOW_DEMO=true → on
 * - Vite dev server → on (unless explicitly false)
 * - Electron → only when cloud is NOT configured
 * Cloud is the source of truth whenever isSupabaseConfigured is true.
 */
export const allowDemoMode =
  env.VITE_ALLOW_DEMO === 'true' ||
  (env.DEV && env.VITE_ALLOW_DEMO !== 'false') ||
  (isElectronBuild && !isSupabaseConfigured);

/** Web production host (not desktop) */
export const isProductionMode = isSupabaseConfigured && !allowDemoMode && !isElectronBuild;

export const appVersion = '1.1.0';
