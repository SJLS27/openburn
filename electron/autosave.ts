import { app, ipcMain } from 'electron';
import path from 'node:path';
import { readJsonFile, removeFile, writeJsonFileAtomic } from './storage';

export interface AutosaveRecord {
  document: unknown;
  filePath: string | null;
  savedAt: string;
}

const AUTOSAVE_FILE = 'autosave.json';

export function autosavePath(userDataDir: string): string {
  return path.join(userDataDir, AUTOSAVE_FILE);
}

/** Accept only well-formed records; anything else is treated as no draft. */
export function normalizeAutosaveRecord(input: unknown): AutosaveRecord | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Partial<AutosaveRecord>;
  if (!record.document || typeof record.document !== 'object') return null;
  if (record.filePath !== null && typeof record.filePath !== 'string') return null;
  if (typeof record.savedAt !== 'string' || record.savedAt.length === 0) return null;
  return {
    document: record.document,
    filePath: record.filePath ?? null,
    savedAt: record.savedAt,
  };
}

export function registerAutosaveHandlers(): void {
  const file = () => autosavePath(app.getPath('userData'));

  ipcMain.handle('autosave:read', () => {
    const stored = readJsonFile<unknown>(file());
    const record = normalizeAutosaveRecord(stored);
    if (!record) removeFile(file());
    return record;
  });

  ipcMain.handle('autosave:write', (_event, payload: unknown) => {
    const record = normalizeAutosaveRecord({
      ...(payload as Record<string, unknown> | null),
      savedAt: new Date().toISOString(),
    });
    if (!record) return false;
    return writeJsonFileAtomic(file(), record);
  });

  ipcMain.handle('autosave:clear', () => {
    removeFile(file());
    return true;
  });
}
