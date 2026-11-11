# Multi-device sync and offline recovery

The web app, Electron desktop app, and mobile browser must all use the **same Supabase project**. They share the same cloud tables; local storage is only a per-device cache and offline outbox.

## What is synchronized

Products and stock, sales and sale items, credit balances/payments, expenses, stock-receive records, held sales, staff profiles, app settings, and activity logs are stored in Supabase and pulled by all signed-in clients. An uncompleted open cart remains local to the device; a completed or held sale is shared.

## Sync behaviour in this build

- Supabase Realtime events trigger a debounced pull (about 120 ms after the related database event burst).
- A 5-second visible-tab safety poll catches events missed during a suspended tab or Realtime interruption.
- Focus, tab visibility, manual refresh, and reconnect trigger an immediate pull.
- Sales, product snapshots, expenses, stock receives, held sales, settings, and activity log writes are retained in the local outbox when the network is unavailable or a write fails. The outbox retries after reconnect and during normal sync cycles.
- Sale retries use the sale's stable local ID as the server idempotency key, preventing a repeated retry from creating a second sale. Credit collection retries use a stable payment ID and the `record_credit_payment_once` RPC, preventing a retry from applying the same payment twice.

Realtime is near-real-time, not a guarantee of zero latency. Actual delivery depends on network quality and Supabase Realtime availability. The 5-second poll is the fallback.

## Required Supabase setup

1. Confirm all clients use the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values. The desktop build and hosted web build must point to the same project.
2. Ensure the base database has been created with `supabase/schema.sql` (and the project's required checkout/login migrations). Then run `supabase/MULTI_DEVICE_SYNC_MIGRATION.sql` once in the Supabase SQL Editor. This adds the shared data tables to the `supabase_realtime` publication where they exist.
3. In Supabase Dashboard, confirm **Database → Publications → supabase_realtime** includes `products`, `sales`, `sale_items`, `stock_receives`, `expenses`, `credits`, `credit_payments`, `app_settings`, `profiles`, `held_sales`, and `activity_logs`.
4. Confirm the existing POS RLS policies and table grants from the project's setup scripts are present. Do not replace production policies with broader policies unless you have reviewed the security impact.
5. Deploy the updated web build and rebuild/reinstall the Electron desktop app. A client running an older build will not have the expanded offline outbox or faster sync loop.

## Device setup

| Client | Setup |
|---|---|
| Web | Deploy the Vite `dist/` build with the correct Supabase environment variables |
| Mobile | Open the same hosted web URL; Add to Home Screen is optional |
| Desktop | Build Electron from this same repository with the same Supabase project values |

There is no separate mobile database. The phone browser uses the same hosted application and Supabase project.

## Verification checklist

1. Open the same business account on two devices.
2. Add or edit a product on device A; verify device B updates without a manual refresh.
3. Complete a sale on A; verify the receipt and reduced stock appear on B.
4. Receive stock, add an expense, edit settings, and create a held sale; verify each appears on B.
5. Temporarily disconnect A, create a sale and an expense, then reconnect A. Confirm the outbox drains and the records appear on B. Do not clear browser data while queued writes are pending.
6. Check the browser console and Supabase logs if a row does not appear. A failed RLS policy, missing table/column, or disabled Realtime publication must be fixed in Supabase; client polling cannot repair a rejected database write.

## Important limits

- Open carts and unsaved form contents are intentionally device-local.
- Two devices editing the same product while offline can produce a last-write-wins product snapshot when both reconnect. Avoid simultaneous offline edits to the same stock/product record; stock-changing sales are processed by the server transaction when online.
- A device must reconnect to upload its own offline outbox. Other devices cannot see records that have not yet reached Supabase.
- Never uninstall/clear site data on a device with pending offline sales or queued changes. Export/backup first if the device is being replaced.
