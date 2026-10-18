/**
 * Electron main process — The Singularity desktop shell (Windows, Linux,
 * macOS). Loads the same Vite build the web app ships (`dist/`), so one
 * React codebase serves every surface.
 *
 * Desktop build docs: apps/singularity/README.md + docs/SINGULARITY-PLATFORMS.md.
 * Prerequisite: `npm run desktop:setup` (installs electron + electron-builder;
 * both are intentionally not in package.json so web-only installs stay light).
 */
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');

// Single instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1100,
      height: 780,
      minWidth: 380,
      minHeight: 560,
      title: 'The Singularity',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f6f7f9',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // The build uses relative asset paths (vite base: './'), so file:// works.
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

    // External links open in the system browser, never inside the shell.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  }

  // Minimal menu: enough for reload/dev-tools without the Electron default.
  const menu = Menu.buildFromTemplate([
    {
      label: 'The Singularity',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      // macOS dock click with no windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
