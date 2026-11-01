import { useSyncExternalStore } from 'react';

let files: OpenBurnRecentFile[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setFiles(next: OpenBurnRecentFile[]): void {
  files = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecentFiles(): OpenBurnRecentFile[] {
  return useSyncExternalStore(subscribe, () => files, () => files);
}

export function getRecentFiles(): OpenBurnRecentFile[] {
  return files;
}

/** Reload the list from the main process (no-op outside Electron). */
export async function refreshRecentFiles(): Promise<void> {
  const api = window.openburn?.recent;
  if (!api) {
    setFiles([]);
    return;
  }
  try {
    setFiles(await api.list());
  } catch {
    setFiles([]);
  }
}

export async function addRecentFile(filePath: string): Promise<void> {
  const api = window.openburn?.recent;
  if (!api) return;
  try {
    setFiles(await api.add(filePath));
  } catch {
    /* recents are best-effort */
  }
}

export async function removeRecentFile(filePath: string): Promise<void> {
  const api = window.openburn?.recent;
  if (!api) return;
  try {
    setFiles(await api.remove(filePath));
  } catch {
    /* ignore */
  }
}

export async function clearRecentFiles(): Promise<void> {
  const api = window.openburn?.recent;
  if (!api) return;
  try {
    setFiles(await api.clear());
  } catch {
    /* ignore */
  }
}

/** Test helper: drop module state between cases. */
export function resetRecentFiles(): void {
  files = [];
  listeners.clear();
}
