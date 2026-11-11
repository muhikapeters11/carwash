# Stock deduction and persistence fix

## Required Supabase migration

Before deploying this application, open the Supabase project used by every Carwash POS device, open **SQL Editor**, and run the complete file:

`supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`

Do **not** run any file under `supabase/DEPRECATED_DO_NOT_RUN/` or the older standalone fix scripts. Those overwrite the authoritative RPC.

The migration:

1. Replaces `public.complete_sale` with an atomic sale + stock transaction (row locks, advisory lock on sale id, idempotent retries).
2. Uses a **deterministic receipt number** derived from the sale UUID so offline-printed receipts match the cloud receipt.
3. Adds `CHECK (stock >= 0)` on `public.products` (`products_stock_non_negative`).
4. Ensures `public.products` is in the Realtime publication.

## App-side hardening (this package)

| # | Fix | Behaviour |
|---|-----|-----------|
| 1 | Reuse client sale ID on retry | Same cart content reuses one UUID for up to 15 minutes so a lost HTTP response cannot double-deduct. |
| 2 | Rejected offline sale reconciliation | Permanent server rejections (or 8 failed tries) restore local stock, drop the ghost sale/credit, and raise a notification. |
| 3 | Quarantined old SQL | Older `complete_sale` scripts moved/stubbed under `DEPRECATED_DO_NOT_RUN`. |
| 4 | Non-negative stock constraint | DB rejects negative stock even if application logic regresses. |
| 5 | Deterministic receipts | Offline and server receipts use `R` + first 12 hex chars of the sale UUID. |
| 6 | Acceptance test checklist | Steps and SQL probes below — must be run on **your** project. |

## Required manual acceptance test

Use a **test product**, not live inventory.

### A. Online atomic deduction

1. Set the product stock to **10** in the POS. Confirm `public.products.stock = 10` in Supabase.
2. Sell quantity **2** while online. Wait for the successful receipt.
3. Confirm cloud stock is **8**, one `sales` row exists, and `sale_items.quantity = 2`.
4. Refresh the POS — product must still show **8**.
5. Open a second device and sync — it must also show **8**.

### B. Idempotent retry (same client sale id)

6. In a controlled test only, call `complete_sale` again with the **same** `p_client_sale_id`. Stock must remain **8**; no second sale row.

Optional SQL probe (replace the UUID):

```sql
select id, stock from public.products where id = '<product-uuid>';
select id, receipt_no, total from public.sales where id = '<sale-uuid>';
select product_id, quantity from public.sale_items where sale_id = '<sale-uuid>';
```

### C. Offline → sync

7. Disconnect one test device, sell quantity **1**, confirm it is stored locally as pending.
8. Reconnect and wait for sync. Cloud stock must become **7**. The pending sale must become the cloud sale (same id). Receipt number must match the offline print (`R` + 12 hex chars of the sale id).

### D. Offline rejection + stock restore

9. On device A (online), sell the remaining stock of the test product to **0**.
10. On device B (offline), sell quantity **1** of the same product (local stock will go negative-safe to 0 or stay provisional).
11. Bring device B online. Sync must **reject** the offline sale, restore device B stock toward the cloud value, remove the ghost local sale, and show a notification (“Offline sale not synced”).

### E. Constraint

12. In SQL Editor (should fail):

```sql
update public.products set stock = -1 where id = '<test-product-uuid>';
```

Expect a check-constraint violation on `products_stock_non_negative`.

## Verification status for this package

Source-level wiring for fixes 1–5 is implemented in this ZIP. A production build and live Supabase checkout **cannot** be run from this environment (no project credentials). Treat the acceptance test as **passed only after you execute sections A–E** against your Supabase project.

## Deploy order

1. Run `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql` in Supabase SQL Editor.
2. Deploy this app build to every till (web / desktop).
3. Run acceptance tests A–E on a test product.
4. Only then use live inventory.

## Product images (persist + multi-device)

Product photos are stored in the Supabase Storage bucket `product-images` and the public URL is saved on `public.products.image_url`.

Behaviour in this build:

1. Camera/file picks are compressed to a JPEG data URL in the form.
2. On save (add or edit), the app uploads the image to Storage and writes the **public URL** to the product row.
3. Local state replaces the temporary data URL with that public URL so refresh does not depend on large base64 in `localStorage`.
4. Other devices receive the same URL via product pull / Realtime and show the same photo.
5. If upload is offline, the data URL stays local and is uploaded on the next queue flush / bootstrap backfill.

**Required:** run `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql` (creates the bucket + policies). In the Supabase Dashboard, confirm Storage → `product-images` exists and is public.

### Quick image test

1. Online: edit a product, attach a photo, save.
2. Confirm `products.image_url` in Supabase starts with `http` (Storage public URL), not `data:image`.
3. Refresh the POS — photo still shows.
4. Open a second device / browser profile, sync — same photo appears.
