import type { Product, User } from "@/types";

/**
 * Last-Write-Wins by updated_at.
 * Equal timestamps: keep local stock (recent sale on this device).
 */
export function mergeProductLWW(local: Product, remote: Product): Product {
  const lt = new Date(local.updated_at || 0).getTime();
  const rt = new Date(remote.updated_at || 0).getTime();

  if (rt > lt) {
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

export function mergeCatalog(local: Product[], remote: Product[]): Product[] {
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const rp of remote) {
    const existing = byId.get(rp.id);
    if (!existing) {
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
    } else {
      byId.set(rp.id, mergeProductLWW(existing, rp));
    }
  }
  return Array.from(byId.values());
}



export function mergeUsers(local: User[], remote: User[]): User[] {
  const byId = new Map(local.map((u) => [u.id, u]));
  for (const ru of remote) {
    if (!ru?.id) continue;
    const existing = byId.get(ru.id);
    if (!existing) {
      byId.set(ru.id, {
        is_active: true,
        allowed_tabs: [],
        created_at: new Date().toISOString(),
        ...ru,
      });
    } else {
      const rt = new Date((ru as User & { updated_at?: string }).updated_at || ru.created_at || 0).getTime();
      const lt = new Date((existing as User & { updated_at?: string }).updated_at || existing.created_at || 0).getTime();
      if (rt >= lt) byId.set(ru.id, { ...existing, ...ru });
    }
  }
  const list = Array.from(byId.values()).filter((u) => u.is_active !== false);
  return list.length ? list : local;
}
