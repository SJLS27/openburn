// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const eventHandlers = new Map<string, (payload?: unknown) => void>();
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const windows = [
    {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      },
    },
  ];

  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    logger: null as unknown,
    on: vi.fn((event: string, callback: (payload?: unknown) => void) => {
      eventHandlers.set(event, callback);
    }),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    emit: (event: string, payload?: unknown) => eventHandlers.get(event)?.(payload),
  };

  const app = {
    packaged: false,
    version: '9.9.9',
    getPath: (_name: string) => '/Applications/OpenBurn.app/Contents/MacOS/OpenBurn',
  };

  const codesign = { signed: true, calls: 0 };

  return { eventHandlers, ipcHandlers, sent, windows, autoUpdater, app, codesign };
});

vi.mock('electron', () => ({
  app: {
    getVersion: () => h.app.version,
    get isPackaged() {
      return h.app.packaged;
    },
    getPath: (name: string) => h.app.getPath(name),
  },
  BrowserWindow: { getAllWindows: () => h.windows },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      h.ipcHandlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    h.codesign.calls += 1;
    if (!h.codesign.signed) throw new Error('code object is not signed at all');
    return Buffer.from('');
  }),
}));

vi.mock('electron-updater', () => ({ autoUpdater: h.autoUpdater }));

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(originalPlatform);
});

async function loadUpdater() {
  vi.resetModules();
  h.eventHandlers.clear();
  h.ipcHandlers.clear();
  h.sent.length = 0;
  h.app.packaged = false;
  h.codesign.signed = true;
  h.codesign.calls = 0;
  h.autoUpdater.on.mockClear();
  h.autoUpdater.checkForUpdates.mockClear();
  h.autoUpdater.downloadUpdate.mockClear();
  h.autoUpdater.quitAndInstall.mockClear();
  return import('./updater');
}

describe('electron/updater', () => {
  it('disables updates in unpackaged (development) builds', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    updater.checkForUpdates(true);

    expect(updater.getUpdaterState()).toMatchObject({
      status: 'disabled',
      manual: true,
    });
    expect(updater.getUpdaterState().message).toMatch(/packaged builds/);
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('reports unsigned macOS builds as disabled instead of failing', async () => {
    setPlatform('darwin');
    const updater = await loadUpdater();
    h.app.packaged = true;
    h.codesign.signed = false;

    updater.initUpdater();
    updater.checkForUpdates(true);

    expect(h.codesign.calls).toBe(1);
    expect(updater.getUpdaterState()).toMatchObject({
      status: 'disabled',
      manual: true,
    });
    expect(updater.getUpdaterState().message).toMatch(/signed build/);
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checks for updates on signed macOS builds', async () => {
    setPlatform('darwin');
    const updater = await loadUpdater();
    h.app.packaged = true;
    h.codesign.signed = true;

    updater.initUpdater();
    updater.checkForUpdates(true);

    expect(updater.getUpdaterState().status).toBe('checking');
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('configures electron-updater when initialised', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    expect(h.autoUpdater.autoDownload).toBe(true);
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(h.autoUpdater.on).toHaveBeenCalled();
    expect(h.ipcHandlers.has('updater:check')).toBe(true);
    expect(h.ipcHandlers.has('updater:install')).toBe(true);
  });

  it('tracks the full update lifecycle', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    h.autoUpdater.emit('checking-for-update');
    expect(updater.getUpdaterState().status).toBe('checking');

    h.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseNotes: 'Fresh features',
    });
    expect(updater.getUpdaterState()).toMatchObject({
      status: 'available',
      version: '2.0.0',
      releaseNotes: 'Fresh features',
    });

    h.autoUpdater.emit('download-progress', {
      percent: 40,
      transferred: 10,
      total: 25,
      bytesPerSecond: 100,
    });
    expect(updater.getUpdaterState()).toMatchObject({
      status: 'downloading',
      percent: 40,
      transferred: 10,
      total: 25,
    });

    h.autoUpdater.emit('update-downloaded', { version: '2.0.0' });
    expect(updater.getUpdaterState()).toMatchObject({
      status: 'downloaded',
      version: '2.0.0',
      percent: 100,
    });
  });

  it('flattens release-note arrays into readable text', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    h.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseNotes: [
        { version: '2.0.0', note: 'New updater' },
        { version: '1.9.0', note: 'Fixes' },
      ],
    });

    expect(updater.getUpdaterState().releaseNotes).toBe(
      '2.0.0: New updater\n1.9.0: Fixes',
    );
  });

  it('reports errors and broadcasts state to renderer windows', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updater = await loadUpdater();
    updater.initUpdater();

    h.autoUpdater.emit('error', new Error('offline'));

    expect(updater.getUpdaterState()).toMatchObject({
      status: 'error',
      message: 'offline',
    });
    expect(h.sent.at(-1)).toMatchObject({
      channel: 'updater:event',
      payload: { status: 'error', message: 'offline' },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('only installs after the update has been downloaded', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    const install = h.ipcHandlers.get('updater:install') as () => boolean;
    expect(install()).toBe(false);

    h.autoUpdater.emit('update-downloaded', { version: '2.0.0' });
    expect(install()).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not download unless an update is available', async () => {
    const updater = await loadUpdater();
    updater.initUpdater();

    const download = h.ipcHandlers.get('updater:download') as () => Promise<unknown>;
    await download();
    expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled();

    h.autoUpdater.emit('update-available', { version: '2.0.0' });
    await download();
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });
});
