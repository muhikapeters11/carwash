# Desktop build (Electron)

Verified working path:

```bash
# Use Node 18–22 (Node 24 may work but 20 LTS is recommended)
node -v

# Clean install (required after clone)
rm -rf node_modules
npm install

# Web bundle (must succeed first)
npm run build

# Unpacked desktop app (fast test)
npx electron-builder --dir

# Installer (Windows NSIS / macOS DMG / Linux AppImage)
npx electron-builder
# or: npm run electron:dist
```

## Common `npm install` failures

1. **CI / Netlify / Vercel** – Electron downloads a ~100MB binary. This project sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` on Netlify so web deploys skip it. Local desktop builds must **not** set that variable.

2. **Interrupted install** – Empty folders under `node_modules`. Fix:
   ```bash
   rm -rf node_modules package-lock.json
   npm cache clean --force
   npm install
   ```

3. **Windows path / antivirus** – Exclude the project folder from real-time scan during install.

4. **Node version** – Prefer Node 20 LTS. Avoid very new major versions if install scripts fail.

## Windowed fullscreen

On start the desktop window is **maximized** (windowed fullscreen), not exclusive kiosk mode. See `electron/main.cjs`.
