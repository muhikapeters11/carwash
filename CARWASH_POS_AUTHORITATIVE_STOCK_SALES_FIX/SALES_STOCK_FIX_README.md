# Carwash POS — authoritative sales and stock fix

## What changed

- Online checkout now calls the Supabase `complete_sale` RPC first.
- The till does not clear the cart, add a completed sale, or deduct its displayed stock unless Supabase returns `ok: true`.
- Supabase validates stock and performs the sale row, sale-item rows, credit row (when applicable), and stock deductions in one database transaction.
- Offline checkout remains device-local and is queued for retry with the same sale UUID. It becomes globally committed only after the RPC succeeds on reconnection.
- The SQL migration aggregates duplicate product lines and locks products in a stable order to prevent overselling.

## Required Supabase step

Before deploying this source, open the Supabase project used by all Carwash POS installations, open **SQL Editor**, and run `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql` successfully. This installs/replaces the exact seven-argument RPC called by the app. Do not run only an older checkout SQL file.

The application must be built with the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is expected to be the public Supabase anon/publishable key; never put a service-role key in the client app.

## Deployment

- Netlify base directory: blank (repository root)
- Build command: `npm install --include=dev --no-audit --no-fund && npm run build`
- Publish directory: `dist`
- Node: 20 or newer

## Verification boundary

The source changes were statically inspected. A full Vite production build and a live Supabase checkout test were not completed in this environment because dependency installation timed out and no database connection was available. Therefore this archive must not be described as production-verified until the build and the SQL/live checkout test pass.
