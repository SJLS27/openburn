import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  checkForUpdates,
  initUpdater,
  scheduleUpdateCheck,
} from './updater';
import { readClipboardPayload } from './clipboard';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(__dirname, '../dist/icon.png')
    : path.join(__dirname, '../public/icon.png');
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 680,
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

  // Allow Web Serial access from the renderer (GRBL connection).
  const ses = mainWindow.webContents.session;
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    // Prefer a USB/UART looking port; otherwise use the first one.
    const port =
      portList.find((p) => /usb|tty|acm|serial/i.test(p.portName ?? '')) ?? portList[0];
    callback(port ? port.portId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
}

// ---- IPC handlers ---------------------------------------------------------

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

app.whenReady().then(() => {
  installApplicationMenu();
  initUpdater();
  createWindow();
  scheduleUpdateCheck();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export {};
