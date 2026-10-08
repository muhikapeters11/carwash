import type { Product, User } from "@/types";

/**
 * Last-Write-Wins by updated_at.
 * Local stock is protected when local is newer or equal (receives/sales must stick).
 */
export function mergeProductLWW(
  local: Product,
  remote: Product,
  preferRemoteOnTie = false
): Product {
  const lt = new Date(local.updated_at || 0).getTime();
  const rt = new Date(remote.updated_at || 0).getTime();

  if (rt > lt) {
    // Remote newer — still protect a very recent local stock change (race with pull)
    const localFresh = Date.now() - lt < 120_000; // 2 minutes
    if (localFresh && local.stock_quantity !== remote.stock_quantity && lt >= rt - 1000) {
      return {
        ...remote,
        ...local,
        stock_quantity: local.stock_quantity,
        cost: local.cost ?? remote.cost,
        updated_at: local.updated_at || remote.updated_at,
        units_per_pack: local.units_per_pack ?? remote.units_per_pack ?? 1,
        min_stock: local.min_stock ?? remote.min_stock ?? 0,
        is_active: local.is_active !== false,
      };
    }
    return {
      ...local,
      ...remote,
      units_per_pack: remote.units_per_pack ?? local.units_per_pack ?? 1,
      min_stock: remote.min_stock ?? local.min_stock ?? 0,
      is_active: remote.is_active !== false,
    };
  }

  // Local strictly newer → keep local (recent receive/sale on this device)
  if (lt > rt) {
    return {
      ...remote,
      ...local,
      stock_quantity: local.stock_quantity,
      cost: local.cost ?? remote.cost,
      updated_at: local.updated_at || remote.updated_at,
      units_per_pack: local.units_per_pack ?? remote.units_per_pack ?? 1,
      min_stock: local.min_stock ?? remote.min_stock ?? 0,
      is_active: local.is_active !== false,
    };
  }

  // Tie: prefer remote when cloud-first so all devices match last sync
  if (preferRemoteOnTie) {
    return {
      ...local,
      ...remote,
      units_per_pack: remote.units_per_pack ?? local.units_per_pack ?? 1,
      min_stock: remote.min_stock ?? local.min_stock ?? 0,
      is_active: remote.is_active !== false,
    };
  }

  return {
    ...remote,
    ...local,
    stock_quantity: local.stock_quantity,
    cost: local.cost ?? remote.cost,
    updated_at: local.updated_at || remote.updated_at,
    units_per_pack: local.units_per_pack ?? remote.units_per_pack ?? 1,
    min_stock: local.min_stock ?? remote.min_stock ?? 0,
    is_active: local.is_active !== false,
  };
}

export function mergeCatalog(local: Product[], remote: Product[]): Product[] {
  return mergeCatalogCloudFirst(local, remote);
}

/**
 * Cloud-first catalog for multi-device.
 * - Cloud rows are the base (last synced data on every device).
 * - Local-only products kept only if created in the last 5 minutes (offline add not pushed yet).
 * - For shared ids: LWW, but prefer remote on tie so other devices match cloud.
 */
export function mergeCatalogCloudFirst(
  local: Product[],
  remote: Product[]
): Product[] {
  if (!remote?.length) return local || [];

  const byId = new Map<string, Product>();
  for (const rp of remote) {
    if (!rp?.id) continue;
    byId.set(rp.id, {
      units_per_pack: 1,
      min_stock: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sku: "",
      name: "",
      category: "soft_drinks",
      price: 0,
      cost: 0,
      stock_quantity: 0,
      ...rp,
    });
  }
  for (const lp of local || []) {
    if (!lp?.id) continue;
    const existing = byId.get(lp.id);
    if (!existing) {
      const updated = new Date(lp.updated_at || 0).getTime();
      const age = Date.now() - updated;
      // Only keep very recent offline-created products not yet on cloud
      if (updated > 0 && age < 5 * 60 * 1000) {
        byId.set(lp.id, lp);
      }
    } else {
      byId.set(lp.id, mergeProductLWW(lp, existing, true));
    }
  }
  return Array.from(byId.values());
}

export function mergeUsers(local: User[], remote: User[]): User[] {
  return mergeUsersCloudFirst(local, remote);
}

/**
 * Cloud is the source of truth for the user list when online.
 * - Remote rows win for shared ids (PIN/role changes from other devices stick).
 * - Users deleted on another device disappear (not kept from local).
 * - Local-only users kept only if created very recently (offline add not yet pushed).
 */
export function mergeUsersCloudFirst(local: User[], remote: User[]): User[] {
  if (!remote?.length) {
    return (local || []).filter((u) => u.is_active !== false);
  }

  const byId = new Map<string, User>();
  for (const ru of remote) {
    if (!ru?.id) continue;
    if (ru.is_active === false) continue;
    byId.set(ru.id, {
      is_active: true,
      allowed_tabs: [],
      created_at: new Date().toISOString(),
      ...ru,
    });
  }
  for (const lu of local || []) {
    if (!lu?.id || lu.is_active === false) continue;
    const existing = byId.get(lu.id);
    if (!existing) {
      const ts = new Date(
        (lu as User & { updated_at?: string }).updated_at || lu.created_at || 0
      ).getTime();
      const age = Date.now() - ts;
      // Only keep offline-created users not yet on cloud
      if (ts > 0 && age < 3 * 60 * 1000) {
        byId.set(lu.id, lu);
      }
    } else {
      const rt = new Date(
        (existing as User & { updated_at?: string }).updated_at ||
          existing.created_at ||
          0
      ).getTime();
      const lt = new Date(
        (lu as User & { updated_at?: string }).updated_at || lu.created_at || 0
      ).getTime();
      if (lt > rt) byId.set(lu.id, { ...existing, ...lu });
    }
  }
  const list = Array.from(byId.values()).filter((u) => u.is_active !== false);
  return list.length ? list : local;
}
