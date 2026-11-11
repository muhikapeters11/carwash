# Same data on web, desktop, and mobile

This POS is designed so **every online device shares one cloud database** (Supabase).

## What stays the same across devices

| Data | Shared? |
|------|---------|
| Products & stock | Yes |
| Sales & receipts | Yes |
| Credits & payments | Yes |
| Expenses | Yes |
| Stock receives | Yes |
| Held sales | Yes |
| Staff users | Yes |
| Pub settings / branding | Yes |
| Activity log | Yes |
| **Open cart on Sell screen** | **No** (per device only) |

## How sync works

1. **Write** on any till → saved locally, then pushed to Supabase (or queued if offline).
2. **Realtime** notifies other devices within about 1–2 seconds when online.
3. **Hot pull** every 20 seconds (products, sales, credits, holds, expenses, stock, logs).
4. **Full pull** every 90 seconds as a safety net.
5. **Focus / tab visible / back online** triggers an immediate pull.
6. Offline sales and product edits wait in a queue and flush when the network returns.

## Requirements

1. **Same Supabase project** on web, desktop, and phone  
   - Same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (already in `netlify.toml` for the web build).
2. **Internet** on each device while you need live matching data.
3. Run once in Supabase SQL Editor:

```text
supabase/enable_cloud_sync.sql
```

That turns on Realtime for products, sales, holds, expenses, etc.

## Device types

| Client | How it runs |
|--------|-------------|
| **Web / mobile browser** | Netlify (or any static host) of this app |
| **Desktop** | Electron build of the **same** codebase and same env keys |
| **Phone** | Browser to the Netlify URL (Add to Home Screen optional) |

There is no separate “mobile database”. Phone = web app against the same cloud.

## If one device looks different

1. Check the yellow/pink/red sync indicator (online / syncing / offline).
2. Tap the refresh/sync control in the header.
3. Confirm all devices use the same Supabase URL.
4. Re-run `enable_cloud_sync.sql` if Realtime was never enabled.
5. Wait up to ~20 seconds for the next hot pull, or reopen the app.

## Intentional differences

- **Cart** is local until you complete or hold the sale.
- **Offline** devices keep working; other devices see those changes after reconnect + flush.
