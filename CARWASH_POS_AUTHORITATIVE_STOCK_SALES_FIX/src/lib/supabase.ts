import { createClient } from '@supabase/supabase-js';

/** Canonical project — always used when env is missing or placeholder. */
export const SUPABASE_URL = 'https://tvjdblbxmlteszcigckj.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2amRibGJ4bWx0ZXN6Y2lnY2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MjQ5MzgsImV4cCI6MjExMDAwMDkzOH0.A5xHZivqWlyegdBcrwF_vsjFFkOVik9fODIdmnWXUcI';

function envString(key: string): string {
  // Prefer static property access so Vite can inline at build time.
  const env = (import.meta as ImportMeta & { env: Record<string, string> }).env || {};
  const v = env[key];
  return typeof v === 'string' ? v.trim() : '';
}

const fromEnvUrl = envString('VITE_SUPABASE_URL');
const fromEnvKey = envString('VITE_SUPABASE_ANON_KEY');

export const supabaseUrl =
  fromEnvUrl && !fromEnvUrl.includes('placeholder') ? fromEnvUrl : SUPABASE_URL;
export const supabaseAnonKey =
  fromEnvKey && fromEnvKey.length > 20 && !fromEnvKey.includes('placeholder')
    ? fromEnvKey
    : SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl.startsWith('https://') && supabaseAnonKey.length > 40
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
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  },
});
