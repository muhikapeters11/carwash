import { db } from "@/db/schema";
import type { Product, Sale } from "@/types";
import { assertSale, assertProduct } from "@/lib/assert";

/**
 * Atomic local write: sale + updated product stock in one IndexedDB transaction.
 */
export async function writeSaleTransaction(
  sale: Sale,
  productsAfter: Product[]
): Promise<void> {
  assertSale(sale);
  const touched = productsAfter.filter((p) =>
    sale.items.some((i) => i.product_id === p.id)
  );
  for (const p of touched) assertProduct(p);

  await db.transaction("rw", db.sales, db.products, db.cart, async () => {
    await db.sales.put(sale);
    if (touched.length) await db.products.bulkPut(touched);
    await db.cart.clear();
  });
}
