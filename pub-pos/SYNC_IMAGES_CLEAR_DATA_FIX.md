# Pub POS — sync, product images and clear-data update

## What changed
- A cloud read error is now treated as a failed sync, never as an empty product list. Existing local products therefore remain visible during a temporary network/RLS failure.
- Product photos are compressed before saving, uploaded to the Supabase `product-images` Storage bucket, and stored as public URLs on product rows.
- Sell and Receive Stock share the same image component, with a category icon fallback when an image is missing or cannot load.
- Online product writes that fail are placed in the offline retry queue. Excel-imported products now use the same persistent product-save path.
- First sync can migrate a locally saved catalogue when the cloud catalogue is empty, unless a newer cloud clear/reset marker is present.
- Full cloud sync runs every five minutes. Supabase Realtime remains subscribed for near-live updates; reconnect, app focus and manual refresh also trigger a pull.
- Settings now has an Admin-only **Clear Products & Reports** action. It removes products, sales, sale items, credits/payments, expenses, stock receiving records, held sales and activity logs, while preserving staff accounts and pub settings.

## Supabase setup
1. Open the Supabase project configured in this app.
2. Open **SQL Editor**.
3. Run `supabase/CLEAR_PRODUCTS_AND_REPORTS.sql` once.
4. Confirm the SQL completes successfully. This creates the product image bucket/policies and the PIN-verified cleanup RPC.

The existing full schema must already be installed. If it is not, run the supplied `supabase/schema.sql` and the existing login/cloud setup migrations first.

## Desktop build
1. Extract this ZIP.
2. Open a terminal in the extracted `pub-pos` folder.
3. Run `npm install`.
4. Run `npm run typecheck` and `npm run electron:dist`.
5. Install the generated installer from the `release` folder.

The project includes its configured `.env` file from the source archive. Keep the Supabase anon/publishable key public; never add a service-role key to the desktop app.

## Important test note
The changed TypeScript/TSX files passed syntax transpilation checks in the preparation environment. A full TypeScript check, desktop package build, and live Supabase/Realtime test were not run because the project dependencies are not installed here and this environment has no authenticated access to the user's Supabase project. Do not treat the update as live-tested until you run the SQL migration and test it on the desktop app.
