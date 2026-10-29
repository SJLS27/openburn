import { app, BrowserWindow, ipcMain } from 'electron';
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';

/**
 * Auto-update state shared with the renderer.
 *
 * `disabled` means the bridge is running but this build cannot self-update
 * (dev builds, Flatpak, or a Linux install that is not the AppImage). The
 * renderer shows a friendly explanation instead of an error.
 */
export type UpdaterStatus =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
  /** True when the user explicitly asked for the update check. */
  manual?: boolean;
}

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion(),
};

let started = false;

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:event', state);
  }
}

function patch(next: Partial<UpdaterState>): void {
  state = { ...state, ...next };
  broadcast();
  if (state.status === 'error') {
    console.error(`[updater] ${state.message ?? 'unknown error'}`);
  }
}

/** Reason why this build cannot update itself, or null when it can. */
function unsupportedReason(): string | null {
  if (!app.isPackaged) {
    return 'Automatic updates are only available in packaged builds.';
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return 'Automatic updates on Linux require the AppImage build. Flatpak and distro packages update through their own store.';
  }
  return null;
}

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes;
  return notes
    .map((entry) => `${entry.version}: ${entry.note ?? ''}`.trim())
    .join('\n');
}

export function getUpdaterState(): UpdaterState {
  return state;
}

export function checkForUpdates(manual = false): void {
  const reason = unsupportedReason();
  if (reason) {
    patch({ status: 'disabled', message: reason, manual });
    return;
  }

  patch({ status: 'checking', message: undefined, manual });
  autoUpdater.checkForUpdates().catch((err: Error) => {
    patch({ status: 'error', message: err?.message ?? String(err), manual });
  });
}

/** Queue a background check shortly after the window opens. */
export function scheduleUpdateCheck(delayMs = 5000): void {
  if (unsupportedReason()) return;
  setTimeout(() => checkForUpdates(false), delayMs);
}

export function initUpdater(): void {
  if (started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    patch({ status: 'checking', message: undefined });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    patch({
      status: 'available',
      version: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    patch({ status: 'not-available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    patch({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    patch({
      status: 'downloaded',
      version: info.version,
      percent: 100,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    });
  });

  autoUpdater.on('error', (err: Error) => {
    patch({ status: 'error', message: err?.message ?? String(err) });
  });

  ipcMain.handle('updater:get-state', () => state);

  ipcMain.handle('updater:check', (_event, manual?: boolean) => {
    checkForUpdates(manual === true);
    return state;
  });

  ipcMain.handle('updater:download', async () => {
    if (state.status !== 'available') return state;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      patch({ status: 'error', message: (err as Error).message });
    }
    return state;
  });

  ipcMain.handle('updater:install', () => {
    if (state.status !== 'downloaded') return false;
    // isSilent = false, isForceRunAfter = true: run the app again after install.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });
}
