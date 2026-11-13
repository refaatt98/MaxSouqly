// MAX Management — desktop shell around the web app.
// Everything the system needs runs from the site, so updates reach the app on their own.
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

const APP_URL = 'https://maxsouqly.netlify.app';
const APP_HOST = new URL(APP_URL).host;

// one window only: opening the app again focuses the running one
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    title: 'MAX Management',
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#131110',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // keep the window title on the app name
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle('MAX Management');
  });

  // links to other sites open in the normal browser; the system itself stays in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).host === APP_HOST) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const host = new URL(url).host;
    if (host !== APP_HOST && !url.startsWith('file:')) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  // no internet: show a friendly page that retries by itself
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation replaced, not an error
    void win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url || APP_URL } });
  });

  // Ctrl/Cmd + R reload, F11 full screen, Ctrl/Cmd + +/- zoom
  win.webContents.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta;
    if (input.type !== 'keyDown') return;
    if ((mod && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      win.webContents.reloadIgnoringCache();
      event.preventDefault();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (mod && (input.key === '=' || input.key === '+')) {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
      event.preventDefault();
    } else if (mod && input.key === '-') {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
      event.preventDefault();
    } else if (mod && input.key === '0') {
      win.webContents.setZoomLevel(0);
      event.preventDefault();
    }
  });

  void win.loadURL(APP_URL);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // the site may use notifications, sound and fullscreen; nothing else is granted
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const host = (() => {
      try {
        return new URL(wc.getURL()).host;
      } catch {
        return '';
      }
    })();
    callback(host === APP_HOST && ['notifications', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });

  if (process.platform === 'darwin') {
    // standard Mac menu so copy / paste / quit shortcuts work
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
        { role: 'windowMenu' },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
