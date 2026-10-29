import { useSyncExternalStore } from 'react';

export type UpdateStatus =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
  /** True when the user explicitly asked for the update check. */
  manual?: boolean;
}

const CURRENT_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const INITIAL: UpdateState = {
  status: 'idle',
  currentVersion: CURRENT_VERSION,
};

function bridge() {
  return typeof window !== 'undefined' ? window.openburn?.updater : undefined;
}

type Listener = () => void;

class UpdateStore {
  private state: UpdateState = INITIAL;
  private listeners = new Set<Listener>();
  private bridgeAttached = false;

  getState = (): UpdateState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.attachBridge();
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private attachBridge(): void {
    if (this.bridgeAttached) return;
    const api = bridge();
    if (!api) return;
    this.bridgeAttached = true;

    api.onEvent((next) => this.set(next));
    api.onOpenDialog(() =>
      window.dispatchEvent(new CustomEvent('openburn:update-dialog-open')),
    );

    // Hydrate with the state the main process already has (e.g. a background
    // check that finished before this window subscribed).
    void api
      .getState()
      .then((next) => {
        if (this.state.status === 'idle') this.set(next);
      })
      .catch(() => {
        /* bridge unavailable */
      });
  }

  async check(manual = true): Promise<void> {
    const api = bridge();
    if (!api) {
      this.set({
        status: 'disabled',
        manual,
        message: 'Automatic updates are only available in the desktop app.',
      });
      return;
    }
    this.set({ status: 'checking', manual, message: undefined, percent: undefined });
    try {
      this.set(await api.check(manual));
    } catch (err) {
      this.set({ status: 'error', message: (err as Error).message, manual });
    }
  }

  async download(): Promise<void> {
    const api = bridge();
    if (!api) return;
    try {
      this.set(await api.download());
    } catch (err) {
      this.set({ status: 'error', message: (err as Error).message });
    }
  }

  async install(): Promise<void> {
    const api = bridge();
    if (!api) return;
    try {
      await api.install();
    } catch (err) {
      this.set({ status: 'error', message: (err as Error).message });
    }
  }
}

export const updateStore = new UpdateStore();

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getState,
    updateStore.getState,
  );
}

export function checkForUpdates(manual = true): Promise<void> {
  return updateStore.check(manual);
}

export function downloadUpdate(): Promise<void> {
  return updateStore.download();
}

export function installUpdate(): Promise<void> {
  return updateStore.install();
}
