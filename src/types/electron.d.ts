export {};

declare global {
  interface OpenBurnFileApi {
    openFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
    saveFile(options?: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<string | null>;
    readFile(filePath: string, encoding?: string): Promise<string>;
    readBinary(filePath: string): Promise<{ data: string; mime?: string }>;
    readAppAsset(relativePath: string): Promise<string>;
    readClipboard(): Promise<{ text?: string; html?: string; image?: string | null }>;
    writeFile(filePath: string, content: string, encoding?: string): Promise<boolean>;
    platform: string;
    isElectron: boolean;
  }

  interface Window {
    openburn?: OpenBurnFileApi;
  }
}
