# GitHub + Netlify deployment (repository-root layout)

This archive is deliberately flattened: `package.json`, `netlify.toml`, `index.html`,
`vite.config.ts`, `src/`, and `supabase/` are at the ZIP/repository root.

## GitHub upload
Extract this ZIP and upload/commit the **contents** of this folder to the root of
`muhikapeters11/carwash` (not the containing folder). The repository root must show
`package.json` and `netlify.toml` side by side.

## Netlify settings
- Base directory: leave blank (repository root)
- Build command: `npm install --include=dev --no-audit --no-fund && npm run build`
- Publish directory: `dist`
- Node version: 20 (also declared in `netlify.toml`)

Do not set the base directory to `pub-pos`; this archive no longer has that wrapper
folder. Netlify reads `netlify.toml` from the repository root.

The existing Supabase sales/stock migration is retained at:
`supabase/FINAL_AUTHORITATIVE_SALES_STOCK.sql`
Run it in Supabase SQL Editor if it has not already been applied.
