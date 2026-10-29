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
    updater?: OpenBurnUpdaterApi;
    platform: string;
    isElectron: boolean;
  }

  interface Window {
    openburn?: OpenBurnFileApi;
  }
}
