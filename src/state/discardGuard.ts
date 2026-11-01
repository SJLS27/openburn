import { store } from './store';

/** Event dispatched when the UI must ask before discarding unsaved changes. */
export const DISCARD_CONFIRM_EVENT = 'openburn:confirm-discard';

let resolver: ((ok: boolean) => void) | null = null;

/**
 * Resolve to true when it is safe to replace the current document (it is clean
 * or the user chose Save/Discard), false when the user cancelled.
 */
export function requestDiscardConfirmation(): Promise<boolean> {
  if (!store.getState().dirty) return Promise.resolve(true);
  // A dialog is already open; treat the extra request as cancelled.
  if (resolver) return Promise.resolve(false);
  return new Promise((resolve) => {
    resolver = resolve;
    window.dispatchEvent(new Event(DISCARD_CONFIRM_EVENT));
  });
}

export function resolveDiscardConfirmation(ok: boolean): void {
  const pending = resolver;
  resolver = null;
  pending?.(ok);
}

/** Test helper: drop any pending request. */
export function resetDiscardGuard(): void {
  const pending = resolver;
  resolver = null;
  pending?.(false);
}
