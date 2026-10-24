import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#26282c',
    title: 'OpenBurn',
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

// Read a bundled renderer asset (fonts, icons) from the built dist folder.
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export {};
