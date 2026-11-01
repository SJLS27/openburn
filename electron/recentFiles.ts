import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from './storage';

export interface RecentFile {
  path: string;
  name: string;
  openedAt: string;
}

export const MAX_RECENT_FILES = 10;

const RECENT_FILE = 'recent-files.json';

export function recentFilesPath(userDataDir: string): string {
  return path.join(userDataDir, RECENT_FILE);
}

/** Keep only well-formed entries, de-duplicated by path, most recent first. */
export function normalizeRecentList(input: unknown): RecentFile[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: RecentFile[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<RecentFile>;
    if (typeof candidate.path !== 'string' || candidate.path.length === 0) continue;
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    result.push({
      path: candidate.path,
      name:
        typeof candidate.name === 'string' && candidate.name.length > 0
          ? candidate.name
          : path.basename(candidate.path),
      openedAt: typeof candidate.openedAt === 'string' ? candidate.openedAt : '',
    });
    if (result.length >= MAX_RECENT_FILES) break;
  }
  return result;
}

/** Move `entry` to the top of the list, dropping duplicates and overflow. */
export function addRecentFile(list: RecentFile[], entry: RecentFile): RecentFile[] {
  return [
    entry,
    ...list.filter((existing) => existing.path !== entry.path),
  ].slice(0, MAX_RECENT_FILES);
}

export function registerRecentHandlers(): void {
  const file = () => recentFilesPath(app.getPath('userData'));
  const load = () =>
    normalizeRecentList(readJsonFile<unknown>(file())).filter((entry) =>
      fs.existsSync(entry.path),
    );

  const add = (filePath: string): RecentFile[] => {
    const list = addRecentFile(load(), {
      path: filePath,
      name: path.basename(filePath),
      openedAt: new Date().toISOString(),
    });
    writeJsonFileAtomic(file(), list);
    return list;
  };

  ipcMain.handle('recent:list', () => load());

  ipcMain.handle('recent:add', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return load();
    return add(filePath);
  });

  ipcMain.handle('recent:remove', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return load();
    const list = load().filter((entry) => entry.path !== filePath);
    writeJsonFileAtomic(file(), list);
    return list;
  });

  ipcMain.handle('recent:clear', () => {
    writeJsonFileAtomic(file(), []);
    return [];
  });
}
