/** Lightweight runtime asserts (Zod-style without extra dependency) */

export function assertProduct(p: any) {
  if (!p || typeof p.id !== "string" || !p.id) throw new Error("Product: id required");
  if (typeof p.name !== "string" || !p.name.trim()) throw new Error("Product: name required");
  const price = Number(p.price);
  const cost = Number(p.cost);
  const stock = Number(p.stock_quantity);
  if (Number.isNaN(price) || price < 0) throw new Error("Product: invalid price");
  if (Number.isNaN(cost) || cost < 0) throw new Error("Product: invalid cost");
  if (Number.isNaN(stock) || stock < 0) throw new Error("Product: invalid stock");
  return {
    ...p,
    price,
    cost,
    stock_quantity: stock,
    min_stock: Math.max(0, Number(p.min_stock) || 0),
    units_per_pack: Math.max(1, Number(p.units_per_pack) || 1),
    is_active: p.is_active !== false,
  };
}

export function assertSale(s: any) {
  if (!s || typeof s.id !== "string" || !s.id) throw new Error("Sale: id required");
  if (!Array.isArray(s.items)) throw new Error("Sale: items required");
  if (typeof s.total !== "number" || s.total < 0) throw new Error("Sale: invalid total");
  return s;
}

export function assertPendingOp(o: any) {
  if (!o || typeof o.id !== "string") throw new Error("Op: id required");
  if (!o.type) throw new Error("Op: type required");
  return o;
}
