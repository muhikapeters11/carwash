# Deploy Pub POS in 5 minutes

## 1. Supabase (one-time)

1. Create a free project at https://supabase.com
2. Go to **SQL Editor** → New query
3. Paste the whole contents of `supabase/schema.sql` → **Run**
4. Run `supabase/fast_checkout_idempotency.sql` → **Run** (safe on a fresh or existing schema; enables safe instant checkout retries).
5. Confirm it worked:

```sql
select public.login_with_pin('233456');
```

You must see `"ok": true`.

**Login after this step:**
- Admin PIN → **233456**
- Cashier PIN → **222222**

## 2. GitHub

1. Create a new repository on GitHub
2. Upload / push this entire folder (the one that contains `package.json`)
3. Do **not** commit a real `.env` file (it is already in `.gitignore`)

## 3. Host (Netlify recommended)

1. Go to https://app.netlify.com → **Add new site** → Import from Git
2. Connect the GitHub repo
3. Build settings are already in `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Before first deploy, open **Site settings → Environment variables** and add:

```
VITE_SUPABASE_URL = https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY = your-real-anon-key
VITE_ALLOW_DEMO = false
```

5. Trigger a deploy

## 4. Open the live site and enter PIN 233456

That is all.

---

### If login still fails

- Open browser DevTools → Network tab → look for the call to `login_with_pin`
- In Supabase SQL Editor run again: `select public.login_with_pin('233456');`
- Make sure you did **not** only create a user under Authentication. This app ignores Authentication.
- After changing environment variables you must redeploy.
