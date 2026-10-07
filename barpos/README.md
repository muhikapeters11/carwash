# Bar POS v0.5.1

Offline-first bar Point of Sale (Windows touch / web).

## Stack
- React + Vite + TypeScript + Tailwind
- **Zustand** – UI state (+ localStorage persist for cart & catalog)
- **Dexie (IndexedDB)** – local database
- **Supabase** – optional cloud multi-device sync + Realtime

## Login
| Role | PIN |
|------|-----|
| Admin | `1234` |
| Cashier | `0000` |

## Run (Windows CMD)

```cmd
cd %USERPROFILE%\Desktop\bar-pos
rmdir /s /q node_modules
npm install
npm run dev
```

Open **http://localhost:1420**

## Cloud (multi-device) — optional
1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor  
   (this also adds tables to the **Realtime** publication so sales, stock, expenses, users, etc. appear on other tills immediately)
2. Either:
   - Copy `.env.example` → `.env` and set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, or
   - Settings → Cloud → paste URL + anon key → Save
3. Open the app on each device and use **Sync now** once (or wait for automatic sync)

**What syncs live across devices:** sales, product stock/prices, receive stock, inventory audits, expenses, users, product returns, suppliers, credits.

Without URL/key the app runs fully offline on this device only.

### Existing projects (Realtime only on products)
If you ran an older schema, run this in the SQL Editor (ignore “already member” errors):

```sql
alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table stock_receives;
alter publication supabase_realtime add table stock_audits;
alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table product_returns;
alter publication supabase_realtime add table suppliers;
alter publication supabase_realtime add table credit_events;
```

## Local data & reload survival
- **IndexedDB** (`barpos_local_v1`) via Dexie — full business snapshot
- **localStorage** (`barpos-v2`) — catalog, sales, **cart**, held sales, settings
- Cart is flushed to Dexie on every change and on tab hide / page unload
- Session is not persisted (re-login after refresh); cart is kept
- First launch migrates older localStorage data into Dexie automatically
