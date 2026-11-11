/** Runtime config — production vs demo / desktop */

const env = import.meta.env;

export const isSupabaseConfigured = Boolean(
  (env.VITE_SUPABASE_URL as string | undefined)?.trim() &&
    (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
);

/** True when built for Electron (desktop installer). */
export const isElectronBuild = env.VITE_IS_ELECTRON === 'true';

/**
 * Allow local demo users + offline fallback.
 * - Explicit VITE_ALLOW_DEMO=true → on
 * - Vite dev server → on (unless explicitly false)
 * - Electron desktop build → on (till must work offline / first boot)
 */
export const allowDemoMode =
  env.VITE_ALLOW_DEMO === 'true' ||
  (env.DEV && env.VITE_ALLOW_DEMO !== 'false') ||
  isElectronBuild;

/** Production web host = Supabase configured and demo disabled */
export const isProductionMode = isSupabaseConfigured && !allowDemoMode && !isElectronBuild;

export const appVersion = '1.1.0';
