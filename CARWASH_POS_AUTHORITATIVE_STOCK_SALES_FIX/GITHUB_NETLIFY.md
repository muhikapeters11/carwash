# GitHub + Netlify deploy (no build errors)

## Push to GitHub

```bash
unzip PUB_POS_GITHUB_NETLIFY.zip
cd pub-pos
git init
git add .
git commit -m "Pub POS"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Do **not** add a `.env` file. It is gitignored. Keys for Netlify are already in `netlify.toml`.

## Connect Netlify

1. https://app.netlify.com → **Add new site** → **Import an existing project**
2. Choose **GitHub** → select this repo
3. Netlify reads `netlify.toml` automatically:
   - Build command: `npm install --include=dev --no-audit --no-fund && npm run build`
   - Publish directory: `dist`
   - Node 20
4. Click **Deploy site**

No extra environment variables are required for the first deploy (URL + anon key are in `netlify.toml`).

## After deploy

1. Open the Netlify URL
2. Sign in with your admin PIN
3. If products/sales clear fails, run `supabase/CLEAR_PRODUCTS_AND_REPORTS.sql` in the Supabase SQL Editor once

## Optional: override keys in Netlify UI

Site settings → Environment variables:

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon key |
| `VITE_ALLOW_DEMO` | `false` |

Then **Trigger deploy** again.

## Common Netlify issues (already handled)

| Issue | Fix in this package |
|-------|---------------------|
| Electron download fails build | `ELECTRON_SKIP_BINARY_DOWNLOAD=1` + `ignore_scripts` |
| SPA routes 404 | `[[redirects]]` → `/index.html` |
| Missing Vite/devDeps | `--include=dev` in build command |
| Wrong Node | `NODE_VERSION = "20"` |
