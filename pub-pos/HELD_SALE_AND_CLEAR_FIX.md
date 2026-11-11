# Held sale flicker + clear products/sales (fresh start)

## Held sales disappearing / reappearing

**Cause**
1. On every full cloud pull, local `heldSales` were **replaced** with only cloud rows. A hold created offline or before the upsert finished was wiped, then came back when the cloud write succeeded or realtime fired.
2. `cleanExpiredHolds` only removed expired holds **locally**. The cloud row stayed, so the next pull restored them.

**Fix**
- `applyPull` now **merges** local pending holds with cloud holds (same pattern as sales/credits). Tombstoned and expired rows are filtered out.
- `cleanExpiredHolds` marks expired holds as tombstoned and deletes them from Supabase so they cannot return.
- `pullHotData` also loads `held_sales` so other tills see holds sooner without waiting for the 5‑minute full sync.

## Delete all sales and products (fresh start)

Already available under **Settings** (admin only):

| Button | What it deletes | What it keeps |
|--------|-----------------|---------------|
| **Clear Products & Reports** | Products, sales, sale items, credits, expenses, stock receives, held sales, activity logs (cloud + this device) | Staff accounts and pub settings |
| **Factory Reset** | Everything above **plus** other staff accounts and settings | Only the admin who confirms the reset |

Both require the six-digit admin PIN. With Supabase configured you must be online so cloud data is wiped first; otherwise local clear is blocked when cloud fails.

SQL support (already in `supabase/`):
- `CLEAR_PRODUCTS_AND_REPORTS.sql` / RPC `clear_products_and_reports`
- `factory_reset_cloud.sql` / RPC `factory_reset_cloud`
- `PUB_POS_ALL_IN_ONE.sql` includes the above

**How to use for a fresh catalogue**
1. Sign in as admin → **Settings**.
2. Prefer **Clear Products & Reports** if you want to keep cashiers.
3. Use **Factory Reset** only for a brand-new system with a single admin.
4. Re-add products (or restore from a backup if you made one first).
