// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openburn-autosave-'));
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
  const autosave = await import('./autosave');
  autosave.registerAutosaveHandlers();
  return {
    ...autosave,
    read: h.ipcHandlers.get('autosave:read') as () => unknown,
    write: h.ipcHandlers.get('autosave:write') as (event: unknown, payload: unknown) => unknown,
    clear: h.ipcHandlers.get('autosave:clear') as () => unknown,
  };
}

describe('electron/autosave', () => {
  it('writes, reads and clears a draft', async () => {
    const autosave = await register();
    expect(autosave.read()).toBeNull();

    const document = { format: 'openburn', canvas: { objects: [] } };
    expect(autosave.write(null, { document, filePath: '/tmp/design.obrn' })).toBe(true);

    const stored = autosave.read() as { document: unknown; filePath: string; savedAt: string };
    expect(stored.document).toEqual(document);
    expect(stored.filePath).toBe('/tmp/design.obrn');
    expect(new Date(stored.savedAt).toString()).not.toBe('Invalid Date');

    autosave.clear();
    expect(autosave.read()).toBeNull();
    expect(fs.existsSync(autosave.autosavePath(h.userDataDir))).toBe(false);
  });

  it('drops malformed payloads without touching disk', async () => {
    const autosave = await register();
    expect(autosave.write(null, null)).toBe(false);
    expect(autosave.write(null, { filePath: '/tmp/a.obrn' })).toBe(false);
    expect(autosave.write(null, { document: {} })).toBe(false);
    expect(fs.existsSync(autosave.autosavePath(h.userDataDir))).toBe(false);
  });

  it('removes corrupted drafts when reading', async () => {
    const autosave = await register();
    const file = autosave.autosavePath(h.userDataDir);
    fs.writeFileSync(file, '{"document":{}}');

    expect(autosave.read()).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});
