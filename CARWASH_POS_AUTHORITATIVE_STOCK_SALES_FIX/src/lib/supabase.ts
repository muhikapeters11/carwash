import { createClient } from '@supabase/supabase-js';

/**
 * Baked-in project credentials (same as vite.config / netlify.toml).
 * import.meta.env is preferred when present; these fallbacks prevent
 * "Failed to fetch" against a placeholder host on misconfigured hosts.
 */
const FALLBACK_URL = 'https://tvjdblbxmlteszcigckj.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2amRibGJ4bWx0ZXN6Y2lnY2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MjQ5MzgsImV4cCI6MjExMDAwMDkzOH0.A5xHZivqWlyegdBcrwF_vsjFFkOVik9fODIdmnWXUcI';

function readEnv(name: string): string {
  try {
    const v = (import.meta as any).env?.[name];
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

const envUrl = readEnv('VITE_SUPABASE_URL');
const envKey = readEnv('VITE_SUPABASE_ANON_KEY');

const supabaseUrl =
  envUrl && !envUrl.includes('placeholder') ? envUrl : FALLBACK_URL;
const supabaseAnonKey =
  envKey && !envKey.includes('placeholder') ? envKey : FALLBACK_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('placeholder') &&
    supabaseAnonKey.length > 20
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      apikey: supabaseAnonKey,
    },
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

export { supabaseUrl };
