# Build the Desktop App (Windows / macOS / Linux)

Desktop, web, and mobile **must use the same Supabase project**.  
Vite now **bakes the production URL + anon key** into every Electron build (same values as Netlify), so the installer matches the live web app even if `.env` is missing.

## Build installer

```bash
npm install
npm run electron:dist
```

Installer → `release/Carwash-Setup-*.exe` (Windows) or the platform equivalent.

## Dev window

```bash
npm run electron:dev
```

## Login (same as web)

Use the **cloud admin/cashier PINs** (from Supabase), not old demo-only PINs, when the PC is online.

| Role    | Typical cloud PIN (after seed/repair SQL) |
|---------|-------------------------------------------|
| Admin   | **233456** (or the PIN you set in Supabase) |
| Cashier | **222222** |

After one successful **online** login, that PIN is cached for offline use on this PC.

## If desktop still shows different data

1. Rebuild with `npm run electron:dist` (this package includes the cloud bake-in fix).
2. Confirm the PC is **online** and the yellow/pink sync indicator is not red/offline.
3. Sign out and sign in again with the **same cloud PIN** used on the phone/web.
4. Optional: clear this PC’s local cache only — in the desktop app open DevTools (if available) or reinstall; cloud data is not deleted.
5. Tap the header **refresh/sync** control after login.

## Important

- Do **not** build a custom desktop pointing at a different Supabase project than Netlify.
- `ELECTRON=true` uses relative asset paths (`base: './'`) for `file://` loading.
