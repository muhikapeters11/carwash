# Deploy Pub POS to Netlify via GitHub

## 1. Push this project to GitHub

1. Create a new repo on GitHub (e.g. `pub-pos`)
2. Unzip this project, then:

```bash
cd pub-pos
git init
git add .
git commit -m "Pub POS"
git branch -M main
git remote add origin https://github.com/YOUR_USER/pub-pos.git
git push -u origin main
```

Do **not** commit `.env` (it is gitignored). Secrets go in Netlify only.

## 2. Connect Netlify

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Choose **GitHub** and authorize
3. Select the `pub-pos` repository
4. Build settings (usually auto from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. **Before deploying**, open **Site settings → Environment variables** and add:

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | `https://tvjdblbxmlteszcigckj.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your anon public key from Supabase |
| `VITE_ALLOW_DEMO` | `false` |

6. Click **Deploy site**

## 3. After deploy

- Open the Netlify URL
- Login with Admin PIN `482916` (after you ran `supabase/schema.sql` in the SQL editor)
- Change PINs in production when possible

## 4. Optional: custom domain

Netlify → Domain management → Add domain.
