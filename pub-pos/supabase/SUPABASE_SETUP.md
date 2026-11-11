# Supabase setup (your project)

**Project URL:** `https://wrtmswnfgutlmkjzdzaj.supabase.co`

## 1. Upload schema

1. Open [Supabase Dashboard](https://supabase.com/dashboard/project/wrtmswnfgutlmkjzdzaj)
2. Go to **SQL Editor** → **New query**
3. Open the file `schema.sql` from this folder
4. Paste the **entire** contents into the editor
5. Click **Run**
6. Run `fast_checkout_idempotency.sql` in a new SQL Editor query. This enables immediate local checkout with safe, duplicate-protected background sync.

You should see success (no errors). Tables + functions + seed users are created.

## 2. Login PINs (seeded)

| Role    | PIN    |
|---------|--------|
| Admin   | 482916 |
| Cashier | 739154 |

Change these after first login (Users tab or SQL `set_profile_pin`).

## 3. App env

Already set in `.env` for local builds:

```
VITE_SUPABASE_URL=https://wrtmswnfgutlmkjzdzaj.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_ALLOW_DEMO=false
```

On Netlify/Vercel, add the same variables in the host dashboard.

## 4. Desktop auto-start

Packaged Electron app registers **Open at login** so it starts after the computer boots and the user signs in.

```bash
npm install
npm install -D electron electron-builder
npm run electron:dist
```

Install the app from `release/`. On first run it enables login startup.

## 5. Update cloud factory reset (required for existing projects)

For an existing Supabase project, open `factory_reset_cloud.sql` in the SQL Editor and run the full file once. This replaces the old one-argument reset RPC with `factory_reset_cloud(p_pin, p_admin_id)`, adds the reset metadata columns if missing, and reloads the PostgREST schema cache. The reset RPC verifies the PIN against the currently signed-in active admin, clears products, sales and dependent business records in one transaction, and retains only that admin account. It also returns product/sale counts and a SQLSTATE diagnostic if anything fails. After the SQL editor reports success, refresh/redeploy the POS app and run Factory Reset from Settings while connected to the internet.
