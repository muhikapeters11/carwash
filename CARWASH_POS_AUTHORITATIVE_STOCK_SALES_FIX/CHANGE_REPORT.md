# Pub POS — Factory Reset Investigation & Fix

## What was wrong

1. The previous cloud reset function hard-coded `DELETE` statements for a fixed set of tables. If a table was missing in an older Supabase database, or another migration had added a foreign-key dependent table, PostgreSQL could abort the function and roll back the entire reset.
2. The app attempted a separate `login_with_pin` request before calling the reset RPC. A slow/unavailable login RPC or missing local offline PIN cache could block the reset before the server-side reset function got a chance to validate the admin PIN.
3. The old reset RPC only returned a generic error to the UI, making it difficult to identify the actual database failure.

## What changed

- Replaced the one-argument RPC with `factory_reset_cloud(p_pin, p_admin_id)`. The PIN must belong to the exact currently signed-in active admin account.
- The reset now clears products, sales, sale items, credit balances/payments, held sales, expenses, stock receives, notifications and activity logs. `TRUNCATE ... CASCADE` handles foreign-key dependent records, while missing optional business tables are skipped.
- Additional public-schema tables referencing profiles are cleared before cashier/other admin profiles are deleted.
- Only the confirming admin profile is retained, so the POS can be accessed and configured after reset.
- The SQL function returns deleted product/sale counts and includes the PostgreSQL SQLSTATE and message if the transaction fails.
- The app no longer performs the fragile duplicate cloud-login check before reset; Supabase validates the PIN in the reset RPC itself.
- Cloud reset is blocked while offline. Local data is only cleared after Supabase confirms the cloud transaction succeeded.
- The reset marker is retained in app settings so other tills invalidate stale local caches and offline queues after their next cloud sync.

## Apply the fix

1. Back up the Supabase project if any records may still be needed.
2. In Supabase Dashboard → SQL Editor, run the complete `supabase/factory_reset_cloud.sql` from this package. Wait for a successful completion message.
3. Deploy the updated app/package so it calls the two-argument RPC.
4. Sign in as the admin whose PIN you will use. Ensure the device is online.
5. Open Settings → Factory Reset, enter that admin's six-digit PIN, and confirm both prompts.
6. The completion alert reports how many products and sales were deleted. Other devices clear stale caches when they next sync.

## Important

I cannot connect to or execute destructive SQL against your Supabase project from this chat. The SQL migration and app code are prepared, but the live cloud products/sales are not deleted until you run the SQL migration and complete Factory Reset in the app. The reset is irreversible. The confirming admin account remains; other cashier/admin profiles are deleted.

## Validation

- Inspected the uploaded project schema, reset RPC, login flow, local Zustand persistence, offline queue and cloud sync/reset-marker handling.
- Checked the modified TypeScript files with the globally available TypeScript compiler. A full typecheck/build could not be completed because this extracted source package has no installed npm dependencies (`react`, Supabase and other packages are absent). Run `npm install`/`npm ci`, then `npm run typecheck` and `npm run build` in your development environment before deployment.
