export {};

declare global {
  interface OpenBurnUpdaterState {
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

  interface OpenBurnUpdaterApi {
    getState(): Promise<OpenBurnUpdaterState>;
    check(manual?: boolean): Promise<OpenBurnUpdaterState>;
    download(): Promise<OpenBurnUpdaterState>;
    install(): Promise<boolean>;
    onEvent(callback: (state: OpenBurnUpdaterState) => void): () => void;
    onOpenDialog(callback: () => void): () => void;
  }

  interface OpenBurnRecentFile {
    path: string;
    name: string;
    openedAt: string;
  }

  interface OpenBurnAutosaveRecord {
    document: unknown;
    filePath: string | null;
    savedAt: string;
  }

  interface OpenBurnAutosaveApi {
    read(): Promise<OpenBurnAutosaveRecord | null>;
    write(record: { document: unknown; filePath: string | null }): Promise<boolean>;
    clear(): Promise<boolean>;
  }

  interface OpenBurnRecentApi {
    list(): Promise<OpenBurnRecentFile[]>;
    add(filePath: string): Promise<OpenBurnRecentFile[]>;
    remove(filePath: string): Promise<OpenBurnRecentFile[]>;
    clear(): Promise<OpenBurnRecentFile[]>;
  }

  interface OpenBurnFileApi {
    openFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
    saveFile(options?: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<string | null>;
    readFile(filePath: string, encoding?: string): Promise<string>;
    readBinary(filePath: string): Promise<{ data: string; mime?: string }>;
    readAppAsset(relativePath: string): Promise<string>;
    readClipboard(): Promise<{
      text?: string;
      html?: string;
      image?: string | null;
      svg?: string | null;
    }>;
    writeFile(filePath: string, content: string, encoding?: string): Promise<boolean>;
    /** Absolute path of a dropped `File` (Electron 32+ removed `File.path`). */
    getFilePath(file: File): string;
    autosave: OpenBurnAutosaveApi;
    recent: OpenBurnRecentApi;
    updater?: OpenBurnUpdaterApi;
    platform: string;
    isElectron: boolean;
  }

  interface Window {
    openburn?: OpenBurnFileApi;
  }
}
