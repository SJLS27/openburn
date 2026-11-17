import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

export interface SerialPortRequest {
  requestId: number;
  ports: { portId: string; name: string; description: string; usb: boolean }[];
  recommendedId: string | null;
}

export interface RecentFile {
  path: string;
  name: string;
  openedAt: string;
}

export interface AutosaveRecord {
  document: unknown;
  filePath: string | null;
  savedAt: string;
}

/** A font face installed on the system, as returned by `fonts:list`. */
export interface SystemFontEntry {
  family: string;
  style: 'regular' | 'bold' | 'italic' | 'bold italic';
  file: string;
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
  fonts: {
    list: (): Promise<{ fonts: SystemFontEntry[]; error?: string }> =>
      ipcRenderer.invoke('fonts:list'),
    read: (file: string): Promise<string> => ipcRenderer.invoke('fonts:read', file),
  },
  /** Absolute path of a dropped `File` (Electron 32+ removed `File.path`). */
  getFilePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) ?? '';
    } catch {
      // Synthetic File objects (e2e, browser fallbacks) have no real path.
      return '';
    }
  },
  autosave: {
    read: (): Promise<AutosaveRecord | null> => ipcRenderer.invoke('autosave:read'),
    write: (record: Omit<AutosaveRecord, 'savedAt'>): Promise<boolean> =>
      ipcRenderer.invoke('autosave:write', record),
    clear: (): Promise<boolean> => ipcRenderer.invoke('autosave:clear'),
  },
  recent: {
    list: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:list'),
    add: (filePath: string): Promise<RecentFile[]> =>
      ipcRenderer.invoke('recent:add', filePath),
    remove: (filePath: string): Promise<RecentFile[]> =>
      ipcRenderer.invoke('recent:remove', filePath),
    clear: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:clear'),
  },
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
  serial: {
    /** Fired when the renderer asks for a port (navigator.serial.requestPort). */
    onChoosePort: (callback: (request: SerialPortRequest) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: SerialPortRequest) =>
        callback(request);
      ipcRenderer.on('serial:choose-port', listener);
      return () => ipcRenderer.removeListener('serial:choose-port', listener);
    },
    /** Answer a request; null cancels it. */
    choosePort: (requestId: number, portId: string | null): void =>
      ipcRenderer.send('serial:port-chosen', requestId, portId),
  },
  platform: process.platform,
  isElectron: true,
};

contextBridge.exposeInMainWorld('openburn', api);
