# Bar POS v0.4.0

Offline-first bar Point of Sale (Windows touch / web).

## Stack
- React + Vite + TypeScript + Tailwind
- **Zustand** – UI state
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

## Cloud (multi-device)
1. Run `supabase/schema.sql` in Supabase SQL Editor
2. Settings → Cloud → URL + anon key (preconfigured if using project defaults)
3. Sync now

## Local data
- Stored in browser **IndexedDB** (`barpos_local_v1`) via Dexie
- Also mirrored in localStorage (`barpos-v2`) for compatibility
- First launch migrates old localStorage data into Dexie automatically
