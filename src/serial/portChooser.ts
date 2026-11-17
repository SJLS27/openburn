import { useSyncExternalStore } from 'react';

/**
 * Renderer side of the desktop serial port chooser. Electron forwards
 * navigator.serial.requestPort() here instead of picking a port silently, and
 * the dialog answers through choose().
 */
export interface PortChooserState {
  request: OpenBurnSerialPortRequest | null;
}

let state: PortChooserState = { request: null };
let lastChoice: OpenBurnSerialPortChoice | null = null;
let unsubscribeBridge: (() => void) | null = null;
const listeners = new Set<() => void>();

function setState(next: PortChooserState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const portChooser = {
  getState: (): PortChooserState => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Start listening to the Electron bridge; a no-op in the browser build. */
  init(): void {
    if (unsubscribeBridge) return;
    const bridge = window.openburn?.serial;
    if (!bridge) return;
    unsubscribeBridge = bridge.onChoosePort((request) => setState({ request }));
  },

  dispose(): void {
    unsubscribeBridge?.();
    unsubscribeBridge = null;
    setState({ request: null });
  },

  /** Answer the pending request; null cancels it. */
  choose(portId: string | null): void {
    const request = state.request;
    if (!request) return;
    lastChoice = request.ports.find((p) => p.portId === portId) ?? null;
    window.openburn?.serial?.choosePort(request.requestId, lastChoice ? portId : null);
    setState({ request: null });
  },

  /** The port picked in the last dialog, consumed once by the connection code. */
  takeLastChoice(): OpenBurnSerialPortChoice | null {
    const choice = lastChoice;
    lastChoice = null;
    return choice;
  },
};

export function usePortChooser(): PortChooserState {
  return useSyncExternalStore(portChooser.subscribe, portChooser.getState, portChooser.getState);
}
