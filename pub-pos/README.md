# Pub POS — Complete Point of Sale for Pubs

A modern, touch-optimized POS for pubs, bars and bottle stores.  
Works as a **web app**, **desktop app**, and **phone browser** — all sharing the same live data when Supabase is configured.

## What’s new (responsive + multi-device)

- **Mobile responsive**: bottom navigation + slide-out menu on phones; sidebar on desktop.
- **Native phone keyboard**: on phones, number/text fields open the system keyboard (`inputMode`) instead of the on-screen virtual pad. Desktop / large touch screens still use the big virtual Numeric + QWERTY pads.
- **Login logo**: single transparent logo (no solid background plate) so it blends with the page / system background.
- **Same data everywhere**: configure Supabase once; web, desktop, and phones all read/write the same database.

## Features

### Login
- Split layout on desktop; stacked branding + PIN on mobile
- 6-digit PIN (auto-submits); show/hide; lock after 5 fails
- On phones: system number keyboard + compact on-screen fallback

### Tabs
1. **Dashboard** — Daily sales, profit, expenses, credit, best seller, low stock, reprint  
2. **Sell** — Category grid, cart, Cash / Credit / Hold  
3. **Receive Stock** — Qty + cost, weighted average cost  
4. **Products** — Images, barrels, XLSX import/export  
5. **Inventory Audit** — Physical count  
6. **Credit** — Customer groups, partial payments  
7. **Expenses**  
8. **Reports** — Daily / weekly / monthly + charts  
9. **Users** — Permissions (admin)  
10. **Activity Log**  
11. **Settings** — Pub name, logo, currency, factory reset  

## Tech stack

- React 18 + TypeScript + Vite  
- Tailwind CSS  
- Zustand (local persistence + offline cache)  
- Supabase (optional but **required for shared multi-device data**)  
- Recharts, xlsx, Lucide  

## Quick start (local demo)

```bash
cd pub-pos
npm install
npm run dev
```

Open http://localhost:5173  

**Demo PINs** (local only, when Supabase is not configured)
- Admin: `482916`
- Cashier: `739154`

Data stays in `localStorage` until you connect Supabase.

---

## Deploy (recommended)

See **[DEPLOY.md](DEPLOY.md)** for deployment. For the updated multi-device outbox and Realtime configuration, also follow **[MULTI_DEVICE_SYNC.md](MULTI_DEVICE_SYNC.md)** — the SQL migration there must be run in Supabase.

1. Run `supabase/schema.sql`, then `supabase/fast_checkout_idempotency.sql` in your Supabase SQL Editor  
2. Add 3 environment variables on Netlify  
3. Push this repo to GitHub → Netlify auto-deploys

**Login PIN after deploy: `233456`**

(This app does **not** use Supabase Authentication. Login is PIN-only against the `profiles` table.)

---

## Deploy as web app

```bash
npm run build
```

Host the `dist/` folder on:

- **Vercel / Netlify / Cloudflare Pages** (drag-and-drop or Git)
- Any static host / Nginx

Example Netlify: connect the repo, build command `npm run build`, publish directory `dist`.

Add the same `VITE_SUPABASE_*` env vars in the host dashboard.

### Install on phone (PWA-style)

Open the site in Chrome/Safari → **Add to Home Screen**.  
The viewport is set for full-screen, safe-area aware layout.

---

## Desktop app (same UI + same data)

### Option A — Electron (quick)

```bash
npm install --save-dev electron electron-builder concurrently wait-on
```

Add scripts to `package.json` (example):

```json
"electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
"electron:build": "vite build && electron-builder"
```

Minimal `electron/main.cjs`:

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { contextIsolation: true },
  });
  if (process.env.VITE_DEV) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);
```

Point `"main": "electron/main.cjs"` in `package.json`.  
Build installers with `electron-builder` for Windows/macOS/Linux.  
The desktop window loads the same built web app → **same Supabase data** as the online site.

### Option B — Tauri (lighter)

Use [Tauri](https://tauri.app) with the Vite frontend for smaller native binaries; still one codebase and one database.

---

## Mobile behaviour summary

| Screen size | Navigation | Keyboard |
|-------------|------------|----------|
| Phone (&lt; 768px) | Bottom bar + hamburger menu | System keyboard (`inputMode`) |
| Tablet / desktop | Left sidebar | Virtual Numeric + QWERTY pads |

Login logo uses a **transparent** image (no white card behind it) so it sits cleanly on the gradient / system background. Prefer a PNG/WebP with alpha for best results.

---

## Thermal printing

Uses `window.print()` with a clean receipt layout. For silent ESC/POS: WebUSB / Web Serial, or a local bridge (Thermalink, AnyPrint, etc.).

## Project structure

```
src/
  components/   Layout, NumericPad, QwertyKeyboard, NativeField
  hooks/        useIsMobile, usePreferNativeKeyboard
  pages/        All tabs + Login
  store/        Zustand store
  types/
  lib/          Supabase client
supabase/
  schema.sql
```

## Notes

- Held sales auto-delete after 6 hours.
- Barrel products store stock in “cups”.
- Currency comes from Settings (default KES).
- Demo mode = `localStorage` only. Production multi-device = Supabase.

---

## Production (items implemented)

### 2. Server-side auth (hashed PINs)
- Local/demo: PINs stored as **SHA-256** (`pin_hash`), never plain text in storage.
- Production: Supabase RPC `login_with_pin` uses **pgcrypto bcrypt** (`crypt`).
- Demo seed only when `VITE_ALLOW_DEMO=true` (dev default). **Production builds set `VITE_ALLOW_DEMO=false`.**

Demo PINs (local demo mode only):
- Admin: `482916`
- Cashier: `739154`

Production PINs (after running schema.sql):
- Admin: `233456`
- Cashier: `222222`

### 3. Server stock rules
- RPC `complete_sale` locks product rows (`FOR UPDATE`), validates stock, deducts, writes sale + items in **one transaction**.
- Client uses `completeSaleFromCartAsync` (server first; offline falls back to local).

### 4. Demo lockdown
```env
VITE_ALLOW_DEMO=false
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
With demo off and no matching server user → login fails (no hardcoded 123456).

### 5. Host + desktop
```bash
npm run build          # static site → dist/
# Netlify / Vercel: netlify.toml / vercel.json included

npm install -D electron electron-builder
npm run electron:dev   # desktop against Vite
npm run electron:dist  # installers in release/
```

### 6. Backup
Settings → **Export backup** (JSON) / **Restore backup**.  
Reminder when last backup > 1 day. Export strips plain PINs.

### 7. Thermal print
Sell receipt → **Print** tries **Web Serial ESC/POS**, then browser print fallback (`src/lib/thermalPrint.ts`).

### Deploy checklist
1. Create Supabase project → run `supabase/schema.sql`, then `supabase/fast_checkout_idempotency.sql`
2. Insert admin profile with `set_profile_pin` / `crypt('YourPin', gen_salt('bf'))`
3. Set env on host: Supabase URL/key, `VITE_ALLOW_DEMO=false`
4. `npm run build` → deploy `dist/` over HTTPS
5. Schedule DB backups in Supabase dashboard + use Export backup on each till weekly
