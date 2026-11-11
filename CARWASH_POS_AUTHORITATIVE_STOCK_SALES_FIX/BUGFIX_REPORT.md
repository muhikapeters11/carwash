# Pub POS — Investigation & Bugfix Report
**Date:** 2026-11-10  
**Package:** PUB_POS_STOCK_CREDIT_SYNC_FIX

---

## Critical root cause (stock + credit)

### Problem
After a sale, stock did not stay deducted. After receive stock, stock did not stay increased. Credit sales given by a cashier did not appear on the admin Credit tab and disappeared after refresh.

### Root cause
The Postgres function `public.complete_sale` inserted rows into `sale_items` **before** inserting the parent row into `sales`.  
`sale_items.sale_id` has a foreign key to `sales(id)`. That order causes a foreign-key violation, so the entire RPC fails.  

Consequences:
1. Server stock is never deducted.
2. The `credits` row is never created for credit sales.
3. Local stock is adjusted immediately, then the next cloud pull overwrites products with the old server stock — so the till appears to “undo” the sale/receive.
4. Offline queue keeps retrying the same broken RPC.

### Fix
- Rewrote `complete_sale` so the **sales** row is inserted first, then stock is deducted and **sale_items** are written, then **credits** (for credit method).
- Client now applies `stock_updates` returned by a successful RPC.
- Client merges pending local credits into the Credit tab until the cloud confirms them.
- While offline queue still has jobs, product pulls keep local stock for products that differ from the cloud (prevents mid-sync wipe).

**SQL to run:** `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`

---

## Product delete comes back as inactive

### Problem
Deleting a product removed it locally, but after refresh it returned as **Inactive**.

### Root cause
`deleteProductRemote` only set `is_active = false` (soft delete). Local code removed the product from the array. The next pull loaded the inactive row again.

### Fix
- New RPC `hard_delete_product(uuid)` permanently deletes the product (nulls historical FKs that would block delete).
- Client calls that RPC first; falls back to soft-delete only if the RPC is missing.
- Run the same `FINAL_AUTHORITATIVE_SALES_STOCK.sql` migration.

---

## Refresh button always spinning / system always “syncing”

### Problem
Refresh icon spun continuously. Status looked permanently busy.

### Causes
1. Realtime debounce was only 250ms; a sale triggers products + sales + sale_items + credits events, which chained syncs.
2. Spin was tied to `refreshing || syncing`, so any background sync spun the button.
3. Status used green for “online idle” instead of the requested yellow.

### Fix
- Realtime debounce increased to **1500ms**.
- Refresh icon spins **only** during a manual refresh (`refreshing`), not every background sync.
- Single status dot placed **next to the sync/refresh button**:
  - **Red** = offline  
  - **Pink (pulse)** = syncing  
  - **Yellow** = online, not syncing  

---

## Hold sale freezes Sell screen to white

### Problem
Holding a sale sometimes turned the Sell screen white (React render crash).

### Likely causes
1. Held cart items stored full product objects; cloud round-trip could return incomplete shapes.
2. Unhandled errors during `held_sales` upsert.

### Fix
- `holdSale` now stores a plain JSON-safe product snapshot and is wrapped in try/catch.
- Pull mapping normalizes held items (product + quantity) and drops invalid rows.
- Upsert errors are logged instead of bubbling into the UI.

---

## Print popup does not disappear / thermal compatibility

### Problem
After Print, the receipt popup stayed open. Thermal layout was not constrained.

### Fix
- Receipt window uses 80mm-oriented CSS (`@page size: 80mm`).
- Window closes on `onafterprint` and also after a 2.5s fallback timeout.
- Web Serial ESC/POS path is unchanged for USB thermal printers that support it.

---

## Factory reset & clear products/reports

Already present in Settings (Admin):

| Action | Effect | Keeps |
|--------|--------|--------|
| **Clear Products & Reports** | Deletes products, sales, credits, expenses, stock receives, held sales, activity logs | Staff accounts + settings |
| **Factory Reset** | Full cloud wipe via `factory_reset_cloud` + local storage clear | Only the confirming admin account |

**SQL (already in package):**
- `supabase/CLEAR_PRODUCTS_AND_REPORTS.sql`
- `supabase/factory_reset_cloud.sql` / `FACTORY_RESET_LOGIN_MIGRATION.sql`

Use **Clear Products & Reports** when you want a clean catalogue and empty reports but keep every user. Use **Factory Reset** for a true new system with only the confirming admin.

---

## Tab-by-tab review

| Tab | Findings | Status after fix |
|-----|----------|------------------|
| **Dashboard** | Relies on sales/expenses/credits from store; was empty/wrong when RPC failed | Should reflect real sales once complete_sale works |
| **Sell** | Stock not sticking; hold white-screen; credit not syncing; print popup | Fixed (stock, hold, credit path, print close) |
| **Receive Stock** | Local stock updated via `updateProduct` + queue; wiped by pull when push lagging | Protected while queue has pending product jobs |
| **Products** | Delete → inactive on refresh | Hard delete RPC |
| **Inventory Audit** | Uses `updateProduct` same path as receive | Same stock protection |
| **Credit** | Admin did not see cashier credits; refresh cleared local-only credits | Pending local credits merged; RPC creates cloud credits |
| **Expenses** | Push on add; no structural bug found | OK |
| **Reports** | Driven by sales/expenses; was empty when sales never landed | OK after complete_sale fix |
| **Users** | Profile CRUD separate from sale path | OK |
| **Activity Log** | Best-effort insert | OK |
| **Settings** | Clear / Factory Reset present; PIN-gated | OK — run SQL migrations first |

---

## Always-syncing investigation

Background sync is intentional:
- Full pull every **5 minutes**
- Hot pull on **window focus**
- Hot pull on **Supabase Realtime** (products, sales, credits, …)
- Full pull on **network online** and **manual refresh**

What looked like “always syncing” was mainly the short Realtime debounce + the refresh icon bound to the global syncing flag. Both are adjusted as above. If the pink dot still stays on for long stretches, check the browser console for repeated pull failures (RLS / network) — a failed pull still ends the sync indicator in `finally`.

---

## SQL files to run (order)

1. If the project is new: `supabase/schema.sql` then `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`
2. **Required for this fix:** `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`
3. Optional cleanup tools: `supabase/CLEAR_PRODUCTS_AND_REPORTS.sql`, `supabase/factory_reset_cloud.sql`
4. Login/seed if needed: `supabase/seed_users.sql` / `REPAIR_LOGIN_CREDENTIALS.sql`

---

## Client files changed

- `src/lib/sync.ts` — hard delete, held-sale mapping, Realtime debounce  
- `src/lib/offline.ts` — pass stock_updates to sale sync callback  
- `src/lib/thermalPrint.ts` — auto-close print window, 80mm page  
- `src/store/useStore.ts` — safe holdSale; apply stock_updates after sale sync  
- `src/App.tsx` — merge pending credits; protect local stock while queue pending; apply stock_updates  
- `src/components/Layout.tsx` — single yellow/pink/red dot next to refresh; spin only on manual refresh  
- `supabase/schema.sql` — complete_sale order fixed for new installs  
- `supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql` — migration for existing projects  

---

## How to apply

1. Open Supabase → SQL Editor.  
2. Paste and run `FINAL_AUTHORITATIVE_SALES_STOCK.sql`. Confirm success.  
3. Rebuild / redeploy the desktop or web app from this updated source.  
4. Test: sell one item → stock drops and stays down after refresh; credit sale appears under Credit for admin; delete a product → it stays gone after refresh; hold a sale → no white screen; print → popup closes.  
5. Optional: Settings → **Clear Products & Reports** (admin PIN) to wipe catalogue and history while keeping users.
