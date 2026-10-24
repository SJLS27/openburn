import { contextBridge, ipcRenderer } from 'electron';

export interface OpenDialogFilters {
  name: string;
  extensions: string[];
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
  readClipboard: (): Promise<{ text?: string; html?: string; image?: string | null }> =>
    ipcRenderer.invoke('clipboard:read'),
  platform: process.platform,
  isElectron: true,
};

contextBridge.exposeInMainWorld('openburn', api);
