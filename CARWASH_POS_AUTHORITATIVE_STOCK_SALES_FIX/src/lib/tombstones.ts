/**
 * Local tombstones so a cloud pull cannot restore items the user just deleted
 * (e.g. soft-delete on server, slow delete, or offline queue re-upload).
 */

const PRODUCT_KEY = 'pub-pos-deleted-products';
const HELD_KEY = 'pub-pos-deleted-held';
const MAX = 500;

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function save(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set).slice(-MAX)));
  } catch {
    /* quota */
  }
}

export function markProductDeleted(id: string): void {
  const s = load(PRODUCT_KEY);
  s.add(String(id));
  save(PRODUCT_KEY, s);
}

export function markHeldDeleted(id: string): void {
  const s = load(HELD_KEY);
  s.add(String(id));
  save(HELD_KEY, s);
}

export function isProductTombstoned(id: string): boolean {
  return load(PRODUCT_KEY).has(String(id));
}

export function isHeldTombstoned(id: string): boolean {
  return load(HELD_KEY).has(String(id));
}

export function filterTombstonedProducts<T extends { id: string }>(list: T[]): T[] {
  const dead = load(PRODUCT_KEY);
  if (!dead.size) return list;
  return list.filter((p) => !dead.has(String(p.id)));
}

export function filterTombstonedHeld<T extends { id: string }>(list: T[]): T[] {
  const dead = load(HELD_KEY);
  if (!dead.size) return list;
  return list.filter((h) => !dead.has(String(h.id)));
}

/** After a full clear / factory reset, drop tombstones (catalogue is empty). */
export function clearAllTombstones(): void {
  try {
    localStorage.removeItem(PRODUCT_KEY);
    localStorage.removeItem(HELD_KEY);
  } catch {
    /* ignore */
  }
}
