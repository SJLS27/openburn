import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRecentFile,
  clearRecentFiles,
  getRecentFiles,
  refreshRecentFiles,
  removeRecentFile,
  resetRecentFiles,
} from './recentStore';

const entry = (path: string): OpenBurnRecentFile => ({
  path,
  name: path.split('/').pop() ?? path,
  openedAt: '2026-11-01T00:00:00.000Z',
});

const mocks = {
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

function installBridge(): void {
  (window as unknown as { openburn: unknown }).openburn = {
    isElectron: true,
    recent: mocks,
  };
}

beforeEach(() => {
  resetRecentFiles();
  vi.clearAllMocks();
});

afterEach(() => {
  delete (window as unknown as { openburn?: unknown }).openburn;
});

describe('state/recentStore', () => {
  it('stays empty without the Electron bridge', async () => {
    await refreshRecentFiles();
    expect(getRecentFiles()).toEqual([]);
    await addRecentFile('/tmp/a.obrn');
    expect(getRecentFiles()).toEqual([]);
  });

  it('hydrates from the main process', async () => {
    installBridge();
    mocks.list.mockResolvedValue([entry('/tmp/a.obrn')]);

    await refreshRecentFiles();

    expect(mocks.list).toHaveBeenCalled();
    expect(getRecentFiles()).toHaveLength(1);
    expect(getRecentFiles()[0].path).toBe('/tmp/a.obrn');
  });

  it('updates the list when adding, removing and clearing', async () => {
    installBridge();
    mocks.add.mockResolvedValue([entry('/tmp/new.obrn')]);
    mocks.remove.mockResolvedValue([]);
    mocks.clear.mockResolvedValue([]);

    await addRecentFile('/tmp/new.obrn');
    expect(getRecentFiles().map((f) => f.path)).toEqual(['/tmp/new.obrn']);

    await removeRecentFile('/tmp/new.obrn');
    expect(getRecentFiles()).toEqual([]);

    await addRecentFile('/tmp/new.obrn');
    await clearRecentFiles();
    expect(getRecentFiles()).toEqual([]);
  });

  it('ignores bridge failures', async () => {
    installBridge();
    mocks.list.mockRejectedValue(new Error('ipc down'));

    await refreshRecentFiles();
    expect(getRecentFiles()).toEqual([]);
  });
});
