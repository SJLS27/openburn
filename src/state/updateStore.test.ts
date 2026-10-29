import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@/state/updateStore';

type StateListener = (state: UpdateState) => void;

function makeBridge() {
  const listeners: StateListener[] = [];
  const dialogListeners: Array<() => void> = [];
  const api = {
    getState: vi.fn(async (): Promise<UpdateState> => ({
      status: 'idle',
      currentVersion: '1.0.0',
    })),
    check: vi.fn(async (): Promise<UpdateState> => ({
      status: 'checking',
      currentVersion: '1.0.0',
    })),
    download: vi.fn(async (): Promise<UpdateState> => ({
      status: 'downloading',
      currentVersion: '1.0.0',
      percent: 0,
    })),
    install: vi.fn(async () => true),
    onEvent: vi.fn((callback: StateListener) => {
      listeners.push(callback);
      return () => {
        listeners.splice(listeners.indexOf(callback), 1);
      };
    }),
    onOpenDialog: vi.fn((callback: () => void) => {
      dialogListeners.push(callback);
      return () => {
        dialogListeners.splice(dialogListeners.indexOf(callback), 1);
      };
    }),
  };

  return {
    api,
    emit: (state: UpdateState) => listeners.forEach((listener) => listener(state)),
    openDialog: () => dialogListeners.forEach((listener) => listener()),
  };
}

async function loadUpdateStore() {
  vi.resetModules();
  return import('@/state/updateStore');
}

beforeEach(() => {
  vi.resetModules();
  delete (window as { openburn?: unknown }).openburn;
  window.history.replaceState({}, '', '/');
});

describe('updateStore', () => {
  it('reports that updates are unavailable outside the desktop app', async () => {
    const { updateStore } = await loadUpdateStore();
    await updateStore.check(true);

    expect(updateStore.getState().status).toBe('disabled');
    expect(updateStore.getState().manual).toBe(true);
    expect(updateStore.getState().message).toMatch(/desktop app/);
  });

  it('hydrates from the main process and forwards events', async () => {
    const bridge = makeBridge();
    (window as unknown as { openburn: unknown }).openburn = {
      updater: bridge.api,
      isElectron: true,
      platform: 'linux',
    };

    const { updateStore } = await loadUpdateStore();
    const unsubscribe = updateStore.subscribe(() => {});
    await Promise.resolve();

    expect(bridge.api.getState).toHaveBeenCalled();
    expect(bridge.api.onEvent).toHaveBeenCalled();

    bridge.emit({
      status: 'downloading',
      currentVersion: '1.0.0',
      version: '1.1.0',
      percent: 42,
    });

    expect(updateStore.getState()).toMatchObject({
      status: 'downloading',
      percent: 42,
      version: '1.1.0',
    });

    unsubscribe();
  });

  it('delegates check, download and install to the bridge', async () => {
    const bridge = makeBridge();
    (window as unknown as { openburn: unknown }).openburn = {
      updater: bridge.api,
      isElectron: true,
      platform: 'linux',
    };

    const { updateStore } = await loadUpdateStore();
    updateStore.subscribe(() => {});

    await updateStore.check(true);
    expect(bridge.api.check).toHaveBeenCalledWith(true);
    expect(updateStore.getState().status).toBe('checking');

    await updateStore.download();
    expect(bridge.api.download).toHaveBeenCalled();

    await updateStore.install();
    expect(bridge.api.install).toHaveBeenCalled();
  });

  it('opens the update dialog when the native menu asks for it', async () => {
    const bridge = makeBridge();
    (window as unknown as { openburn: unknown }).openburn = {
      updater: bridge.api,
      isElectron: true,
      platform: 'linux',
    };

    await loadUpdateStore();
    // subscribe() is what attaches the bridge listeners.
    const { updateStore } = await import('@/state/updateStore');
    updateStore.subscribe(() => {});

    const opened = vi.fn();
    window.addEventListener('openburn:update-dialog-open', opened);
    bridge.openDialog();

    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('openburn:update-dialog-open', opened);
  });
});
