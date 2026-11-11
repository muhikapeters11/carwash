# POS speed improvements

## What changed

1. **Faster login:** checks locally cached, previously verified staff credentials first instead of waiting for Supabase on every login. First-time logins still use the cloud PIN RPC.
2. **Immediate checkout:** creates the sale locally and returns it to the cashier without awaiting the network. Cloud stock deduction and receipt confirmation run in the background.
3. **Safe retries:** checkout sends a stable client-generated sale UUID. The database RPC returns the existing sale if a retry arrives, rather than creating a duplicate or deducting stock twice.
4. **Discount preservation:** the queued sale retains its discount percentage during background sync.

## Required Supabase step

Run `supabase/fast_checkout_idempotency.sql` once in Supabase SQL Editor before deploying. It replaces the `complete_sale` RPC with an idempotent version. Existing sales are not deleted or modified.

## Important behavior

Local checkout is immediate, but cloud confirmation is asynchronous. If another till sells the remaining stock before the queued sale reaches Supabase, the server can reject that sale. The server-side row lock remains the final stock authority. Use online tills and monitor the sync indicator.

## Verification

- ZIP archive integrity checked.
- Source changes reviewed for stable client sale IDs and background queue calls.
- Full production build requires installing npm dependencies; this environment may not have them available.
