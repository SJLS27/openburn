// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addRecentFile, normalizeRecentList } from './recentFiles';

const h = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  return { ipcHandlers, userDataDir: '' };
});

vi.mock('electron', () => ({
  app: { getPath: () => h.userDataDir },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      h.ipcHandlers.set(channel, handler);
    },
  },
}));

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-recent-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  h.ipcHandlers.clear();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function register() {
  h.ipcHandlers.clear();
  h.userDataDir = tempDir();
  vi.resetModules();
  const recents = await import('./recentFiles');
  recents.registerRecentHandlers();
  return {
    ...recents,
    list: h.ipcHandlers.get('recent:list') as () => Array<{ path: string }>,
    add: h.ipcHandlers.get('recent:add') as (e: unknown, p: unknown) => Array<{ path: string }>,
    remove: h.ipcHandlers.get('recent:remove') as (e: unknown, p: unknown) => Array<{ path: string }>,
    clear: h.ipcHandlers.get('recent:clear') as () => Array<{ path: string }>,
  };
}

function touch(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{}');
  return file;
}

describe('electron/recentFiles', () => {
  it('normalizes malformed entries and de-duplicates paths', () => {
    const list = [{ path: '/a.obrn' }, { path: '/a.obrn' }, null, { nope: true }, { path: '/b.obrn' }];

    expect(normalizeRecentList(list)).toEqual([
      { path: '/a.obrn', name: 'a.obrn', openedAt: '' },
      { path: '/b.obrn', name: 'b.obrn', openedAt: '' },
    ]);
  });

  it('keeps only the ten most recent files', () => {
    const list = Array.from({ length: 15 }, (_, i) => ({
      path: `/f${i}.obrn`,
      name: `f${i}.obrn`,
      openedAt: '',
    }));

    expect(normalizeRecentList(list)).toHaveLength(10);
  });

  it('moves an existing entry to the top', () => {
    const list = [
      { path: '/b.obrn', name: 'b.obrn', openedAt: '' },
      { path: '/a.obrn', name: 'a.obrn', openedAt: '' },
    ];
    const next = addRecentFile(list, { path: '/a.obrn', name: 'a.obrn', openedAt: 'now' });

    expect(next.map((entry) => entry.path)).toEqual(['/a.obrn', '/b.obrn']);
  });

  it('adds, lists, removes and clears recent files', async () => {
    const recents = await register();
    const dir = h.userDataDir;
    const a = touch(dir, 'a.obrn');
    const b = touch(dir, 'b.obrn');

    expect(recents.list()).toEqual([]);
    recents.add(null, a);
    expect(recents.add(null, b).map((entry) => entry.path)).toEqual([b, a]);
    expect(recents.list().map((entry) => entry.path)).toEqual([b, a]);

    expect(recents.remove(null, a).map((entry) => entry.path)).toEqual([b]);
    expect(recents.clear()).toEqual([]);
    expect(recents.list()).toEqual([]);
  });

  it('hides files that were deleted or moved', async () => {
    const recents = await register();
    const a = touch(h.userDataDir, 'gone.obrn');
    recents.add(null, a);
    fs.rmSync(a);

    expect(recents.list()).toEqual([]);
  });
});
