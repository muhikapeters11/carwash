/**
 * PIN hashing helpers.
 * - Browser: Web Crypto SHA-256 (for local/demo storage — never store plain PIN).
 * - Server: pgcrypto crypt() via Supabase RPC (production).
 */

const encoder = new TextEncoder();

export async function hashPin(pin: string, salt = 'pub-pos-v1'): Promise<string> {
  const data = encoder.encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPinHash(pin: string, hash: string, salt = 'pub-pos-v1'): Promise<boolean> {
  if (!hash) return false;
  const h = await hashPin(pin, salt);
  return h === hash;
}
