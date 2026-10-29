import { contextBridge, ipcRenderer } from 'electron';

export interface OpenDialogFilters {
  name: string;
  extensions: string[];
}

export interface UpdaterState {
  status:
    | 'idle'
    | 'disabled'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
  manual?: boolean;
}

const api = {
  openFile: (filters?: OpenDialogFilters[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (options?: {
    defaultPath?: string;
    filters?: OpenDialogFilters[];
  }): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile', options),
  readFile: (filePath: string, encoding = 'utf-8'): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath, encoding),
  readBinary: (filePath: string): Promise<{ data: string; mime?: string }> =>
    ipcRenderer.invoke('fs:readBinary', filePath),
  writeFile: (filePath: string, content: string, encoding = 'utf-8'): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content, encoding),
  readAppAsset: (relativePath: string): Promise<string> =>
    ipcRenderer.invoke('app:readAsset', relativePath),
  readClipboard: (): Promise<{
    text?: string;
    html?: string;
    image?: string | null;
    svg?: string | null;
  }> => ipcRenderer.invoke('clipboard:read'),
  updater: {
    getState: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:get-state'),
    check: (manual = true): Promise<UpdaterState> =>
      ipcRenderer.invoke('updater:check', manual),
    download: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
    onEvent: (callback: (state: UpdaterState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdaterState) =>
        callback(state);
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
    /** Fired when the native Help → Check for Updates menu item is clicked. */
    onOpenDialog: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('updater:open-dialog', listener);
      return () => ipcRenderer.removeListener('updater:open-dialog', listener);
    },
  },
  platform: process.platform,
  isElectron: true,
};

contextBridge.exposeInMainWorld('openburn', api);
