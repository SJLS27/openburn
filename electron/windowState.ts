import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from './storage';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface WindowSize {
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 680;
export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1600, height: 1000 };

/** Minimum visible area required for a restored window to be usable. */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 60;

const STATE_FILE = 'window-state.json';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Turn a persisted state into usable bounds. Invalid or off-screen values fall
 * back to the default size without a position, which lets Electron center the
 * window on the primary display.
 */
export function sanitizeWindowState(
  saved: unknown,
  workAreas: Rect[],
  defaults: WindowSize = DEFAULT_WINDOW_SIZE,
): WindowState {
  const raw = (saved ?? {}) as Partial<WindowState>;
  const width =
    isFiniteNumber(raw.width) && raw.width > 0
      ? Math.max(MIN_WINDOW_WIDTH, Math.round(raw.width))
      : defaults.width;
  const height =
    isFiniteNumber(raw.height) && raw.height > 0
      ? Math.max(MIN_WINDOW_HEIGHT, Math.round(raw.height))
      : defaults.height;
  const maximized = raw.maximized === true;

  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || workAreas.length === 0) {
    return { width, height, maximized };
  }

  const candidate: Rect = { x: Math.round(raw.x), y: Math.round(raw.y), width, height };
  const visible = workAreas.some((area) => {
    const hit = overlap(candidate, area);
    return hit.width >= MIN_VISIBLE_WIDTH && hit.height >= MIN_VISIBLE_HEIGHT;
  });

  if (!visible) {
    // The monitor the window lived on is gone: fall back to a centered default.
    return { width: defaults.width, height: defaults.height, maximized };
  }

  // Shrink oversized windows so their title bar stays reachable.
  const area = workAreas.find((candidateArea) => {
    const hit = overlap(candidate, candidateArea);
    return hit.width >= MIN_VISIBLE_WIDTH && hit.height >= MIN_VISIBLE_HEIGHT;
  })!;
  const fitted: Rect = {
    x: candidate.x,
    y: candidate.y,
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
  };
  return { ...fitted, maximized };
}

export function windowStatePath(userDataDir: string): string {
  return path.join(userDataDir, STATE_FILE);
}

export function loadWindowState(file: string): WindowState | null {
  const parsed = readJsonFile<unknown>(file);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as WindowState;
}

/** Persist the bounds atomically; losing them is not worth failing the app. */
export function saveWindowState(file: string, state: WindowState): void {
  writeJsonFileAtomic(file, state);
}
