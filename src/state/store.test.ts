import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE } from '@/gcode/types';

// `store` is a module-level singleton that reads localStorage on import, so
// every test re-imports it after seeding the storage.
async function loadStore() {
  vi.resetModules();
  return import('./store');
}

const DEVICE_KEY = 'openburn.device';

describe('state/store device migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to bottom-left when nothing is stored', async () => {
    const { store } = await loadStore();
    expect(store.getState().device.origin).toBe('bottom-left');
  });

  it.each(['bottom-left', 'top-left', 'bottom-right', 'top-right'] as const)(
    'keeps the stored origin %s',
    async (origin) => {
      localStorage.setItem(DEVICE_KEY, JSON.stringify({ origin }));
      const { store } = await loadStore();
      expect(store.getState().device.origin).toBe(origin);
    },
  );

  it('migrates a legacy device without firmware to auto', async () => {
    localStorage.setItem(
      DEVICE_KEY,
      JSON.stringify({ name: 'GRBL', origin: 'top-left', rapidRate: 4000 }),
    );
    const { store } = await loadStore();
    const device = store.getState().device;
    expect(device.firmware).toBe('auto');
    expect(device.origin).toBe('top-left');
    expect(device.rapidRate).toBe(4000);
  });

  it('falls back to bottom-left for an unknown corner', async () => {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ origin: 'center' }));
    const { store } = await loadStore();
    expect(store.getState().device.origin).toBe(DEFAULT_DEVICE.origin);
  });

  it('falls back to bottom-left for corrupted settings', async () => {
    localStorage.setItem(DEVICE_KEY, '{not json');
    const { store } = await loadStore();
    expect(store.getState().device.origin).toBe('bottom-left');
  });

  it('persists the origin when it changes', async () => {
    const { store } = await loadStore();
    store.updateDevice({ origin: 'top-right' });
    expect(store.getState().device.origin).toBe('top-right');
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}').origin).toBe('top-right');
  });
});
