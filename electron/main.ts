import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import { SerialPortBroker } from './serialPort';
import fs from 'node:fs';
import {
  checkForUpdates,
  initUpdater,
  scheduleUpdateCheck,
} from './updater';
import { readClipboardPayload } from './clipboard';
import { getSystemFonts, registerFontHandlers } from './fonts';
import {
  FONT_FALLBACK_ENV,
  bundledFallbackFont,
  countFcListFonts,
  dirsContainFonts,
  installFallbackFont,
  shouldRelaunchWithFallback,
  systemFontConfigDirs,
} from './fontFallback';
import { registerAutosaveHandlers } from './autosave';
import { registerRecentHandlers } from './recentFiles';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  loadWindowState,
  sanitizeWindowState,
  saveWindowState,
  windowStatePath,
} from './windowState';

// Keep tests and development profiles away from the real user configuration.
const userDataOverride = process.env.OPENBURN_USER_DATA_DIR;
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));

let mainWindow: BrowserWindow | null = null;
const serialPorts = new SerialPortBroker();
let windowStateTimer: NodeJS.Timeout | null = null;

function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  saveWindowState(windowStatePath(app.getPath('userData')), {
    ...win.getNormalBounds(),
    maximized: win.isMaximized(),
  });
}

function trackWindowState(win: BrowserWindow): void {
  const schedule = () => {
    if (windowStateTimer) clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => {
      windowStateTimer = null;
      persistWindowState(win);
    }, 300);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', () => {
    if (windowStateTimer) {
      clearTimeout(windowStateTimer);
      windowStateTimer = null;
    }
    persistWindowState(win);
  });
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(__dirname, '../dist/icon.png')
    : path.join(__dirname, '../public/icon.png');
  const statePath = windowStatePath(app.getPath('userData'));
  const restored = sanitizeWindowState(
    loadWindowState(statePath),
    screen.getAllDisplays().map((display) => display.workArea),
  );
  mainWindow = new BrowserWindow({
    ...(restored.x !== undefined && restored.y !== undefined
      ? { x: restored.x, y: restored.y }
      : {}),
    width: restored.width,
    height: restored.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: '#26282c',
    title: 'OpenBurn',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  trackWindowState(mainWindow);

  if (restored.maximized) mainWindow.maximize();

  // Dropping a file outside the canvas must not navigate away from the editor.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Native context menu for editable fields (text inputs, console, text editing).
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      const flags = params.editFlags;
      if (flags.canUndo) template.push({ role: 'undo' });
      if (flags.canRedo) template.push({ role: 'redo' });
      if (template.length > 0) template.push({ type: 'separator' });
      if (flags.canCut) template.push({ role: 'cut' });
      if (flags.canCopy) template.push({ role: 'copy' });
      if (flags.canPaste) template.push({ role: 'paste' });
      template.push({ type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText.trim().length > 0) {
      template.push({ role: 'copy' });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined });
    }
  });

  // Allow Web Serial access from the renderer (GRBL connection). Electron has
  // no built-in port chooser, so the list goes to the renderer's dialog.
  const ses = mainWindow.webContents.session;
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    serialPorts.open(
      portList,
      (request) => webContents.send('serial:choose-port', request),
      callback,
    );
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
}

// ---- IPC handlers ---------------------------------------------------------

ipcMain.on('serial:port-chosen', (_e, requestId: number, portId: string | null) => {
  serialPorts.resolve(requestId, portId);
});

ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_e, options) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: options?.defaultPath,
    filters: options?.filters ?? [{ name: 'OpenBurn Project', extensions: ['obrn'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('fs:readFile', async (_e, filePath, encoding = 'utf-8') => {
  if (encoding === 'binary' || encoding === 'buffer') {
    return fs.promises.readFile(filePath);
  }
  return fs.promises.readFile(filePath, encoding as BufferEncoding);
});

ipcMain.handle('fs:writeFile', async (_e, filePath, content, encoding = 'utf-8') => {
  await fs.promises.writeFile(filePath, content, encoding as BufferEncoding);
  return true;
});

ipcMain.handle('fs:readBinary', async (_e, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return { data: buf.toString('base64'), mime: undefined };
});

// Read the system clipboard, including the vector payload that Inkscape (and
// other vector editors) place next to the raster snapshot. Electron 45+ uses
// the async W3C-style clipboard API; see ./clipboard.ts for the format handling.
ipcMain.handle('clipboard:read', () => readClipboardPayload(clipboard));

ipcMain.handle('app:readAsset', async (_e, relativePath) => {
  const safe = String(relativePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  const full = path.join(__dirname, '../dist', safe);
  const buf = await fs.promises.readFile(full);
  return buf.toString('base64');
});

registerFontHandlers(ipcMain);

function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  // LightBurn uses Cmd+H for Flip Horizontal, so the macOS "Hide" role must not
  // steal that accelerator.
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', accelerator: 'Command+Alt+H' },
      { role: 'hideOthers', accelerator: 'Command+Alt+Shift+H' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    { role: 'editMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            // Let the renderer open its update dialog for manual checks.
            mainWindow?.webContents.send('updater:open-dialog');
            checkForUpdates(true);
          },
        },
        { type: 'separator' },
        {
          label: 'OpenBurn on GitHub',
          click: () => {
            void shell.openExternal('https://github.com/SJLS27/openburn');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Give Chromium a font to boot with.
 *
 * Chromium reads fontconfig before any app code runs, so the bundled fallback
 * cannot be injected into the current process: on Linux, when there is no font
 * at all, the window is never created and Skia aborts the process. Instead we
 * write a fontconfig that adds the bundled Inter and relaunch once with it
 * (`fontFallback.ts`). Returns `false` when the relaunch was requested, so the
 * caller stops starting the UI.
 *
 * Machines that have fonts skip all of this and keep their environment as-is.
 */
async function prepareStartupFonts(): Promise<boolean> {
  const { fonts } = await getSystemFonts();
  const listCount = fonts.length > 0 ? fonts.length : countFcListFonts() ?? 0;
  const dirsWithFonts = dirsContainFonts(systemFontConfigDirs());
  const markers = { retried: process.env[FONT_FALLBACK_ENV] === '1' };

  if (!shouldRelaunchWithFallback(process.platform, listCount, dirsWithFonts, markers)) {
    if (markers.retried) {
      // The fallback boot did not help; say so instead of crashing silently.
      dialog.showErrorBox(
        'No fonts found',
        'OpenBurn could not find any font on this system and cannot start.\n\n' +
          'Install at least one font (for example the "fontconfig" package with a ' +
          'base font set) and start OpenBurn again.',
      );
      return false;
    }
    return true;
  }

  const source = bundledFallbackFont(app.getAppPath());
  if (!source) return true; // nothing to offer, let Chromium try anyway

  const layout = installFallbackFont(source, app.getPath('temp'));
  console.warn(
    `[fonts] No system fonts found; relaunching with the bundled fallback (${layout.fontDir}).`,
  );
  // `relaunch` inherits `process.env`, so the variables go there.
  process.env.FONTCONFIG_FILE = layout.configFile;
  process.env[FONT_FALLBACK_ENV] = '1';
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
  return false;
}

prepareStartupFonts()
  .catch((err) => {
    console.error('[fonts] Startup font check failed:', err);
    return true; // never block startup on the check itself
  })
  .then((canStart) => {
    if (!canStart) return;
    app.whenReady().then(() => {
      installApplicationMenu();
      initUpdater();
      registerAutosaveHandlers();
      registerRecentHandlers();
      createWindow();
      scheduleUpdateCheck();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export {};
