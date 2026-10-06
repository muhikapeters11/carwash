# Bar POS — changes (multi-device + stability)

## Multi-device / one shared database
- On startup **when online**: push pending + **pull full cloud** (products, sales, users, stock, expenses, suppliers, settings) before login UI finishes loading (max 10s timeout).
- Offline: uses local IndexedDB only — app still loads and works.
- When tab becomes visible or network returns: automatic silent sync.
- Background sync every ~45s while online.
- Cloud merge: same sales/users/products across devices after sync.

## Login
- Clean PIN pad (no long help text).
- Silent cloud refresh on open when online.

## Sync UI
- Top bar: status only when offline/pending (no Sync buttons cluttering cashier).
- Full Sync controls under **Settings → Cloud sync**.

## Other recent fixes
- Order number: `YYYYMMDD` + sequence (e.g. `20261006001`).
- Thermal receipt: edge print margins, order number on slip.
- Dashboard/Inventory: removed filler description text.
- Netlify: no Tauri deps; `netlify.toml` SPA redirect; requires `src/main.tsx` on GitHub.

## Tabs (reviewed)
| Tab | Status |
|-----|--------|
| Login | Clean; cloud pull on boot |
| Dashboard | Metrics; reprint |
| Sell | Search, cart, payments, receipt |
| Inventory | List audit |
| Receive stock | Receive + notifications |
| Credits | Pay / history |
| Expenses | Record expenses |
| Products | CRUD + import |
| Reports | Daily/weekly/monthly |
| Suppliers | CRUD |
| Users | CRUD + cloud user_upsert |
| Activity log | List |
| Settings | Cloud sync, backup, reset |

## Deploy
Upload full `src/` including `main.tsx`. Netlify publish `dist`.
