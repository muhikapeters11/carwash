# Supabase security before multi-computer deploy

## Current risk
Open policies (`using (true)`) let **anyone with the anon key** read/write all tables, including **user PINs**.

The anon key is embedded in the web app, so treat the URL as **semi-private**.

## Minimum steps before many staff devices
1. Change all default PINs (1234 / 0000).
2. Do not post the Netlify URL publicly.
3. Run `schema_users.sql` so users sync works.
4. Prefer HTTPS only (Netlify already does).

## Better (recommended next)
1. Enable **Supabase Auth** (email or magic link) for admins only, OR
2. Use a **single shared “device password”** edge function that stamps JWT claims, OR
3. Restrict by **business_id** and issue per-bar keys later.

Example tighter policy (after Auth):
```sql
-- only authenticated role
drop policy "anon all users" on users;
create policy "auth users" on users for all
  to authenticated using (true) with check (true);
```

## PIN storage note
PINs are stored in plain text for offline PIN-pad login. For higher security, hash PINs (e.g. bcrypt) and only compare hashes — requires a small login change.

## Stock multi-till
Offline sales can diverge stock until sync + inventory audit.
Procedure: after busy offline periods → **Inventory audit** on one admin device → Sync now.
