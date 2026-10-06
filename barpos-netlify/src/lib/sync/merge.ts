import type { Product, User } from "@/types";

/**
 * Last-Write-Wins by updated_at.
 * Equal timestamps: prefer remote stock when merging cloud-first.
 */
export function mergeProductLWW(
  local: Product,
  remote: Product,
  preferRemoteOnTie = false
): Product {
  const lt = new Date(local.updated_at || 0).getTime();
  const rt = new Date(remote.updated_at || 0).getTime();

  if (rt > lt || (rt === lt && preferRemoteOnTie)) {
    return {
      ...local,
      ...remote,
      units_per_pack: remote.units_per_pack ?? local.units_per_pack ?? 1,
      min_stock: remote.min_stock ?? local.min_stock ?? 0,
      is_active: remote.is_active !== false,
    };
  }
  if (rt < lt) return local;

  return {
    ...remote,
    ...local,
    stock_quantity: local.stock_quantity,
    updated_at: local.updated_at || remote.updated_at,
  };
}

/** Local-base merge (legacy) */
export function mergeCatalog(local: Product[], remote: Product[]): Product[] {
  return mergeCatalogCloudFirst(local, remote);
}

/**
 * Cloud is shared source of truth when remote has rows.
 * Remote catalog is base; local-only offline adds are kept.
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
      // Keep local-only only if created offline (has a real updated_at within last 30 days)
      // Drop old sample/mock rows so phone matches cloud
      const updated = new Date(lp.updated_at || 0).getTime();
      const age = Date.now() - updated;
      if (updated > 0 && age < 30 * 24 * 60 * 60 * 1000) {
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

/** Prefer cloud users/PINs when cloud has any users */
export function mergeUsersCloudFirst(local: User[], remote: User[]): User[] {
  if (!remote?.length) {
    return (local || []).filter((u) => u.is_active !== false);
  }

  const byId = new Map<string, User>();
  for (const ru of remote) {
    if (!ru?.id) continue;
    byId.set(ru.id, {
      is_active: true,
      allowed_tabs: [],
      created_at: new Date().toISOString(),
      ...ru,
    });
  }
  for (const lu of local || []) {
    if (!lu?.id) continue;
    const existing = byId.get(lu.id);
    if (!existing) {
      byId.set(lu.id, lu);
    } else {
      const rt = new Date(
        (existing as User & { updated_at?: string }).updated_at ||
          existing.created_at ||
          0
      ).getTime();
      const lt = new Date(
        (lu as User & { updated_at?: string }).updated_at || lu.created_at || 0
      ).getTime();
      // Prefer cloud (existing) on tie — same PINs on every device
      if (lt > rt) byId.set(lu.id, { ...existing, ...lu });
    }
  }
  const list = Array.from(byId.values()).filter((u) => u.is_active !== false);
  return list.length ? list : local;
}
