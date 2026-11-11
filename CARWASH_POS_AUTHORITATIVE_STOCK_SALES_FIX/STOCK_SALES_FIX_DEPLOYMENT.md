# Carwash POS — Sales and inventory repair

## Root cause found

The deployed fast-checkout SQL variant inserted `sale_items` before its parent `sales` row. Because `sale_items.sale_id` references `sales.id`, Postgres could reject the checkout transaction. The UI had already optimistically reduced local stock, so a later cloud pull restored the unchanged database stock. This made sales appear not to deduct stock and could leave the sale pending in the local outbox.

A second risk was full-product upserts for stock-only changes. A stale product snapshot from one device could overwrite a newer stock value after another device sold items. Stock receiving and inventory audits now use atomic, idempotent database RPCs rather than full-row product upserts.

## Required deployment order

1. Back up the Supabase project.
2. Open Supabase → SQL Editor.
3. Run `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql` in full and wait for success. It repairs `complete_sale`, adds the atomic receive/audit RPCs, and enables realtime for stock adjustments. It does not delete sales or inventory data.
4. Push this ZIP's `pub-pos` directory to the GitHub repository (replace the previous source).
5. Redeploy the web app and rebuild/reinstall the desktop app. Mobile users should refresh/reopen the web/PWA app to load the new client.

## What changed

- Checkout inserts the parent sale before sale items, then deducts stock under product row locks in the same transaction.
- The server validates available stock and creates sale, sale items, credit (if applicable), and stock deductions atomically.
- A stable client sale UUID makes retries idempotent; retries return current stock values.
- Stock receiving increments stock and writes its stock-receive report in one transaction, using the receive UUID to prevent duplicate increments.
- Inventory audit uses an idempotent absolute-count adjustment under a row lock and records the previous/new count.
- Offline stock receives and audits stay in the durable outbox until the server confirms them.
- Product metadata edits update only changed metadata columns; they no longer send stale stock snapshots.
- New product creation still uploads a full initial product row.
- Local sale, product and receive data remain in the persisted Zustand store; cloud data is reloaded after reconnect/realtime updates.

## Safe test procedure

Use a temporary test product or a product with a known count, not a live till item.

1. Note the starting stock in the POS and Supabase `products` table.
2. Sell one unit. Confirm the local stock drops immediately. Confirm a sale row and its `sale_items` rows appear in Supabase and `products.stock` drops by one.
3. Open web, desktop and mobile clients. Confirm they show the same sale and stock. Refresh each client and confirm the values remain.
4. Receive a known quantity. Confirm `products.stock` increases by exactly that quantity and one `stock_receives` row is saved. Refresh and compare all clients.
5. Perform an inventory audit to a known count. Confirm `products.stock` matches the audited count and one `stock_adjustments` row exists. Refresh and compare all clients.
6. Repeat a receive while offline, reconnect, and confirm it is applied once only. Repeat with an offline sale and confirm the sale appears once and stock is deducted once.

## Important

A browser/desktop/mobile client cannot update the live Supabase database until the SQL migration has been applied and the app has been redeployed. The app keeps offline changes queued, but an offline sale is not globally visible to other devices until the originating device reconnects and syncs. Simultaneous offline activity on separate devices cannot be guaranteed to reserve the same stock; the server validates stock at sync time and rejects overselling.
