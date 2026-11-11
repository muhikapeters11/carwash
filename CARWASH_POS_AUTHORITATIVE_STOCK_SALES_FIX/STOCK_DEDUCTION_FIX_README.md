# Stock deduction and persistence fix

## Required Supabase migration

Before deploying this application, open the Supabase project used by every Carwash POS device, open **SQL Editor**, and run the complete file:

`supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`

The migration replaces the seven-argument `public.complete_sale` RPC used by `src/lib/api.ts`. The RPC locks the sale ID and product rows, validates available stock, inserts the sale and sale items, deducts `products.stock`, and returns the committed stock values in one PostgreSQL transaction. A repeated request with the same sale ID returns the existing sale and current stock without deducting twice.

The app's online checkout waits for the RPC response before clearing the cart or changing displayed stock. Offline sales remain in the local queue; both full and hot sync now flush that queue through the same RPC and apply the returned stock values. Pending offline sale quantities are preserved during a cloud pull until they are reconciled.

## Required manual acceptance test

Use a test product, not a live inventory item:

1. Set a product's stock to 10 in the POS and confirm the value is 10 in Supabase `public.products`.
2. Sell quantity 2 while online. Wait for the successful receipt.
3. Confirm Supabase `public.products.stock` is 8, one row exists in `public.sales`, and its `public.sale_items` row has quantity 2.
4. Refresh the POS. The product must still show 8.
5. Open the POS on a second device and sync. It must also show 8.
6. Retry the same RPC request using the same `p_client_sale_id` only in a controlled test. The stock must remain 8 and no second sale row may be created.
7. For offline testing, disconnect one test device, sell 1, and verify it is labelled/persisted locally as pending. Reconnect and wait for sync. Once accepted by Supabase, cloud stock must reduce to 7 and the pending sale must become the cloud sale.

## Verification status for this package

The ZIP archive structure and source-level wiring were checked. A production build and live Supabase checkout could not be run in this environment because dependency installation timed out and no live database credentials/session were available. Do not treat the manual acceptance test as passed until it is run against your Supabase project.
