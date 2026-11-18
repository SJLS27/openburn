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
import {
  grantPath,
  isPathAllowed,
  isWriteTargetAllowed,
  promotePendingPath,
  resetAllowedPaths,
  type PathKind,
} from './pathAllowList';
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

  // A reloaded renderer starts without permissions again.
  mainWindow.webContents.on('did-start-loading', () => resetAllowedPaths());

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
  const [chosen] = result.filePaths;
  grantPath(chosen, 'write'); // picking a file implies reading and later saving it
  return chosen;
});

ipcMain.handle('dialog:saveFile', async (_e, options) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: options?.defaultPath,
    filters: options?.filters ?? [{ name: 'OpenBurn Project', extensions: ['obrn'] }],
  });
  if (result.canceled || !result.filePath) return null;
  grantPath(result.filePath, 'write');
  return result.filePath;
});

/**
 * Ask the renderer whether the user just approved opening `filePath` (a drop
 * onto the canvas). The main process cannot see drag & drop, and the renderer
 * is the untrusted side, but the only thing it can do with a "yes" is read a
 * file the user physically dragged in; a wrong answer cannot reach anything
 * else, because `fs:*` still checks the allow-list.
 */
const pendingApprovals = new Map<number, (approved: boolean) => void>();
let approvalSeq = 0;

function askRendererApproval(filePath: string): Promise<boolean> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  const id = ++approvalSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      resolve(false);
    }, 2000);
    pendingApprovals.set(id, (approved) => {
      clearTimeout(timer);
      pendingApprovals.delete(id);
      resolve(approved);
    });
    win.webContents.send('paths:confirm', id, filePath);
  });
}

/**
 * Drag & drop happens in the renderer, so it is the one telling us the user
 * approved these paths. The grant is limited to files that exist and are not
 * directories, and only allows reading them.
 */
ipcMain.handle('paths:approve', (_e, paths: unknown) => {
  if (!Array.isArray(paths)) return;
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    try {
      if (fs.statSync(candidate).isFile()) grantPath(candidate, 'read');
    } catch {
      /* a path that does not exist grants nothing */
    }
  }
});

ipcMain.on('paths:confirm-result', (_e, id: number, approved: boolean) => {
  pendingApprovals.get(id)?.(approved === true);
});

/**
 * Resolve a path for `fs:*`: allowed outright, or confirmed by the renderer and
 * then remembered so the rest of the workflow (Save, recent files) keeps working.
 */
async function resolvePath(filePath: unknown, kind: PathKind): Promise<string> {
  const requested = typeof filePath === 'string' ? filePath : '';
  if (kind === 'write' ? isWriteTargetAllowed(requested) : isPathAllowed(requested, kind)) {
    return requested;
  }
  if (requested && (await askRendererApproval(requested))) {
    grantPath(requested, kind);
    return requested;
  }
  const error = new Error(`Access denied: ${requested || '(empty path)'} was not opened by the user`);
  (error as NodeJS.ErrnoException).code = 'EACCES';
  throw error;
}

ipcMain.handle('fs:readFile', async (_e, filePath, encoding = 'utf-8') => {
  const allowed = await resolvePath(filePath, 'read');
  if (encoding === 'binary' || encoding === 'buffer') {
    return fs.promises.readFile(allowed);
  }
  return fs.promises.readFile(allowed, encoding as BufferEncoding);
});

ipcMain.handle('fs:writeFile', async (_e, filePath, content, encoding = 'utf-8') => {
  const allowed = await resolvePath(filePath, 'write');
  await fs.promises.writeFile(allowed, content, encoding as BufferEncoding);
  // A save target that did not exist is now a real file: remember it.
  promotePendingPath(allowed);
  return true;
});

ipcMain.handle('fs:readBinary', async (_e, filePath) => {
  const allowed = await resolvePath(filePath, 'read');
  const buf = await fs.promises.readFile(allowed);
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
