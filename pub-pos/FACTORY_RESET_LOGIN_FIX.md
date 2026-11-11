# Factory reset and administrator login repair

## What was wrong

The original login code tried local staff profiles and cached PINs before calling Supabase. After a factory reset those local credentials are intentionally erased, so the only reliable credential is the retained cloud administrator profile. The old flow could also hide cloud RPC errors as PIN failures and count server errors toward the lockout.

The cloud reset function also used `TRUNCATE ... CASCADE`. This migration replaces it with dependency-ordered `DELETE` statements so business records are removed without cascading into the retained administrator profile.

## Apply the SQL migration before deploying

1. Open the Supabase project used by this Netlify site.
2. Open SQL Editor and create a new query.
3. Paste the complete contents of `supabase/FACTORY_RESET_LOGIN_MIGRATION.sql`.
4. Run it and confirm there is no SQL error.
5. Do not run `seed_users.sql`; it can create/replace accounts and is not required.

The migration updates `login_with_pin`, `set_profile_pin`, and `factory_reset_cloud`. It does not change the existing administrator PIN or delete business data when applied. The reset RPC only deletes business data when an administrator explicitly runs Factory Reset in the app.

## Deploy

Deploy this project to the same Netlify site and retain its existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables. Trigger a new deploy after updating the repository.

## Verification

1. Before any further reset, sign in with the existing administrator PIN.
2. Check that the admin dashboard loads.
3. Only then, if you still need to test reset, take a database backup first.
4. Run Factory Reset once while online.
5. After reload, sign in using the exact same administrator PIN.

## Test limitation

The source-level checks and ZIP integrity checks can be run locally. A full Vite build and live Supabase end-to-end login/reset test require npm dependencies and access to your Supabase project; this environment could not reach the npm registry and does not have credentials to execute the live RPC. Do not treat the live deployment as verified until the steps above pass.
