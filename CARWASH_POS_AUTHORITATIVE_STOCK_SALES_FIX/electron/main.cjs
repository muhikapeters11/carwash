const { app, BrowserWindow, shell, nativeImage } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

function createWindow() {
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
  let icon = undefined;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = undefined;
  } catch (_) {
    icon = undefined;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Carwash',
    icon,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    win.loadURL(url).catch((err) => console.error('Failed to load dev server:', err));
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    win.loadFile(indexHtml).catch((err) => console.error('Failed to load index.html:', err));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Register OS auto-start when computer finishes booting / user logs in */
function enableOpenAtLogin() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
      path: process.execPath,
      args: [],
      name: 'Carwash',
    });
    // Re-apply on every launch so it stays enabled
    const settings = app.getLoginItemSettings();
    if (!settings.openAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: [],
      });
    }
  } catch (e) {
    console.warn('openAtLogin not available:', e && e.message);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });

  app.whenReady().then(() => {
    if (app.isPackaged) {
      enableOpenAtLogin();
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
