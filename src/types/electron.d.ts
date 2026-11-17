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

  interface OpenBurnSerialPortChoice {
    portId: string;
    /** OS name: /dev/ttyUSB0, COM3, /dev/cu.usbserial-1410… */
    name: string;
    description: string;
    usb: boolean;
  }

  interface OpenBurnSerialPortRequest {
    requestId: number;
    ports: OpenBurnSerialPortChoice[];
    recommendedId: string | null;
  }

  interface OpenBurnSerialApi {
    onChoosePort(callback: (request: OpenBurnSerialPortRequest) => void): () => void;
    choosePort(requestId: number, portId: string | null): void;
  }

  interface OpenBurnFontEntry {
    family: string;
    style: 'regular' | 'bold' | 'italic' | 'bold italic';
    file: string;
  }

  interface OpenBurnFontsApi {
    /** Every face the OS exposes; `error` explains an empty list. */
    list(): Promise<{ fonts: OpenBurnFontEntry[]; error?: string }>;
    /** Base64 of a font file, limited to paths returned by `list()`. */
    read(file: string): Promise<string>;
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
    fonts: OpenBurnFontsApi;
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
    serial?: OpenBurnSerialApi;
    platform: string;
    isElectron: boolean;
  }

  interface Window {
    openburn?: OpenBurnFileApi;
  }
}
