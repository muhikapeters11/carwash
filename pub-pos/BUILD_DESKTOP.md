# Build the Desktop App (Windows / macOS / Linux)

## Prerequisites
- Node.js **18, 20 or 22** recommended
- A `.env` file in `pub-pos/` (copy from `.env.example` if missing)

## First-time cloud login setup

1. Keep the supplied `.env` file in the `pub-pos` project folder. It points to the configured Supabase project. Do not replace the anon key with a service-role key.
2. In Supabase SQL Editor, run `supabase/REPAIR_LOGIN_CREDENTIALS.sql` once. This creates/updates the Admin and Cashier profiles and sets their bcrypt PIN hashes without deleting sales, products, or stock.
3. Confirm both profiles are active. The login screen currently asks for the six-digit PIN only; the email is the staff account identifier stored in Supabase.
4. Then build the installer using the commands below.

## Clean install

```cmd
rmdir /s /q node_modules
del package-lock.json
npm install
```

## Build installer (includes logo from electron/resources/icon.png)

```cmd
npm run electron:dist
```

Installer → `release\Carwash-Setup-1.1.0.exe`

## Dev window

```cmd
npm run electron:dev
```

## Cloud login PINs (after running REPAIR_LOGIN_CREDENTIALS.sql)

### Cloud / production (after schema.sql on Supabase)
| Role    | PIN    |
|---------|--------|
| Admin   | **233456** |
| Cashier | **222222** |

### Local demo (works offline / first launch on desktop)
| Role    | PIN    |
|---------|--------|
| Admin   | **482916** |
| Cashier | **739154** |

If cloud login fails (no internet / RPC error), desktop still accepts the **demo PINs** above.

After one successful login online, that PIN is cached and works offline.

## Important
- Always build with a `.env` present so Supabase URL/key are baked into the app.
- `npm run electron:dist` sets `ELECTRON=true` so relative asset paths and desktop login fallback work.
